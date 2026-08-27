import { spawn, type ChildProcess } from "node:child_process";

import type { SttSettings } from "./config";
import {
  normalizeWhisperTranscript,
  WhisperEngineError,
  type TranscribeWavOptions,
  type TranscribeWavResult,
  type WhisperEngine,
} from "./engine";
import type { SttPaths } from "./paths";

/**
 * Adaptador del worker aislado de Voxtype.
 *
 * Voxtype carga el modelo en un proceso separado mientras AgenOS graba. Al
 * terminar la frase recibe PCM por stdin, devuelve JSON y sale. De esta forma
 * usamos su motor Whisper sin su daemon de hotkeys ni la escritura simulada,
 * que no encajan con la consola de voz de Electron.
 */

export type VoxtypeEngineOptions = {
  settings: SttSettings;
  paths: SttPaths;
  spawnFn?: typeof spawn;
  env?: Record<string, string | undefined>;
  now?: () => number;
  logger?: (message: string) => void;
  startTimeoutMs?: number;
  inferenceTimeoutMs?: number;
};

type WorkerReply = {
  ok?: boolean;
  text?: unknown;
  error?: unknown;
};

type Worker = {
  child: ChildProcess;
  ready: Promise<void>;
  result: Promise<WorkerReply>;
  stop(error: WhisperEngineError): void;
};

const START_TIMEOUT_MS = 60_000;
const INFERENCE_TIMEOUT_MS = 120_000;

export function voxtypeWorkerArgs(settings: SttSettings, model: string): string[] {
  return [
    "--initial-prompt", settings.initialPrompt,
    // Voxtype recorta el contexto para clips cortos por defecto. En el N100 es
    // mas rapido, pero puede repetir o degradar frases; AgenOS prioriza calidad.
    "--no-whisper-context-optimization",
    "transcribe-worker",
    "--model", model,
    "--language", settings.language,
    "--threads", String(settings.threads),
  ];
}

/** Extrae PCM S16_LE mono a 16 kHz del WAV producido por AgenOS o ffmpeg. */
export function wavToFloat32(wav: Uint8Array): Float32Array {
  const bytes = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new WhisperEngineError("transcription-failed", "Voxtype recibio un WAV no valido.");
  }

  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;

  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) {
      break;
    }

    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bits: bytes.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = bytes.subarray(start, end);
    }
    offset = end + (size % 2);
  }

  if (!format || !data || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000 || format.bits !== 16) {
    throw new WhisperEngineError(
      "transcription-failed",
      "Voxtype necesita audio PCM S16_LE, mono y a 16 kHz.",
    );
  }

  const samples = new Float32Array(Math.floor(data.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = data.readInt16LE(index * 2) / 32_768;
  }
  return samples;
}

export function encodeVoxtypeAudio(samples: Float32Array): Buffer {
  const payload = Buffer.allocUnsafe(4 + samples.length * 4);
  payload.writeUInt32LE(samples.length, 0);
  for (let index = 0; index < samples.length; index += 1) {
    payload.writeFloatLE(samples[index] ?? 0, 4 + index * 4);
  }
  return payload;
}

/** Evita cargar Whisper con silencio digital o una entrada prácticamente muda. */
export function hasAudibleSignal(samples: Float32Array): boolean {
  if (samples.length === 0) return false;
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return peak >= 0.0015 && rms >= 0.0002;
}

export function createVoxtypeEngine(options: VoxtypeEngineOptions): WhisperEngine {
  const { settings, paths } = options;
  const spawnFn = options.spawnFn ?? spawn;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const log = options.logger ?? (() => {});
  const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
  const inferenceTimeoutMs = options.inferenceTimeoutMs ?? INFERENCE_TIMEOUT_MS;

  let worker: Worker | null = null;
  let transcribing = false;
  let disposed = false;

  function status() {
    return {
      available: paths.missing.length === 0,
      reason: paths.missing.length === 0
        ? null
        : `STT local no disponible: falta ${paths.missing.join(" y ")}.`,
      model: paths.model,
      vadModel: paths.vadModel,
      baseUrl: "local://voxtype",
      engine: "voxtype" as const,
    };
  }

  function startWorker(): Worker {
    if (!paths.voxtype || !paths.model) {
      throw new WhisperEngineError("unavailable", status().reason ?? "Voxtype no esta disponible.");
    }

    let child: ChildProcess;
    try {
      child = spawnFn(paths.voxtype, voxtypeWorkerArgs(settings, paths.model), {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...env },
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new WhisperEngineError("unavailable", `No se pudo arrancar Voxtype: ${detail}`);
    }

    let stdoutBuffer = "";
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let resultResolve!: (reply: WorkerReply) => void;
    let resultReject!: (error: Error) => void;
    let sawReady = false;
    let sawResult = false;
    let stopped = false;

    const ready = new Promise<void>((resolvePromise, rejectPromise) => {
      readyResolve = resolvePromise;
      readyReject = rejectPromise;
    });
    const result = new Promise<WorkerReply>((resolvePromise, rejectPromise) => {
      resultResolve = resolvePromise;
      resultReject = rejectPromise;
    });
    // La captura puede cancelarse despues de READY sin llegar a esperar el
    // resultado. El rechazo sigue llegando al consumidor normal, pero no queda
    // como promesa sin manejar en ese camino.
    void result.catch(() => {});

    let startTimer: ReturnType<typeof setTimeout>;

    const settleFailure = (error: WhisperEngineError) => {
      if (!sawReady) {
        sawReady = true;
        readyReject(error);
      }
      if (!sawResult) {
        sawResult = true;
        resultReject(error);
      }
    };

    const stop = (error: WhisperEngineError) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(startTimer);
      settleFailure(error);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      if (worker?.child === child) {
        worker = null;
      }
    };

    startTimer = setTimeout(() => {
      stop(new WhisperEngineError("unavailable", "Voxtype no cargo el modelo a tiempo."));
    }, startTimeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!sawReady && line === "READY") {
          sawReady = true;
          clearTimeout(startTimer);
          readyResolve();
          continue;
        }
        if (!line.startsWith("{")) {
          continue;
        }
        try {
          const reply = JSON.parse(line) as WorkerReply;
          sawResult = true;
          resultResolve(reply);
        } catch {
          stop(new WhisperEngineError("transcription-failed", "Voxtype devolvio JSON no valido."));
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        log(line);
      }
    });
    child.stdin?.on("error", (cause) => {
      stop(new WhisperEngineError("transcription-failed", `Voxtype no pudo recibir el audio: ${cause.message}`));
    });
    child.on("error", (cause) => {
      stop(new WhisperEngineError("unavailable", `No se pudo arrancar Voxtype: ${cause.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(startTimer);
      const error = new WhisperEngineError(
        sawReady ? "transcription-failed" : "unavailable",
        `Voxtype termino con codigo ${code ?? "desconocido"}.`,
      );
      settleFailure(error);
      stopped = true;
      if (worker?.child === child) {
        worker = null;
      }
    });

    return { child, ready, result, stop };
  }

  async function ensureReady(): Promise<void> {
    if (disposed) {
      throw new WhisperEngineError("unavailable", "El motor de STT local ya se ha cerrado.");
    }
    if (!status().available) {
      throw new WhisperEngineError("unavailable", status().reason ?? "Voxtype no esta disponible.");
    }
    if (!worker) {
      worker = startWorker();
    }
    await worker.ready;
  }

  async function transcribeWav(
    wav: Uint8Array,
    transcribeOptions: TranscribeWavOptions = {},
  ): Promise<TranscribeWavResult> {
    if (transcribing) {
      throw new WhisperEngineError("busy", "Voxtype ya esta transcribiendo otra frase.");
    }
    transcribing = true;

    const startedAt = now();
    let active: Worker | null = null;
    let abortReject: ((error: Error) => void) | null = null;
    const aborted = new Promise<never>((_, rejectPromise) => {
      abortReject = rejectPromise;
    });
    const abortError = () => new WhisperEngineError("cancelled", "Transcripcion de Voxtype cancelada.");
    const onAbort = () => {
      const error = abortError();
      (active ?? worker)?.stop(error);
      abortReject?.(error);
    };
    transcribeOptions.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (transcribeOptions.signal?.aborted) throw abortError();
      await Promise.race([ensureReady(), aborted]);
      if (transcribeOptions.signal?.aborted) throw abortError();
      active = worker;
      if (!active || !active.child.stdin) {
        throw new WhisperEngineError("transcription-failed", "Voxtype perdio el proceso de transcripcion.");
      }

      const samples = wavToFloat32(wav);
      if (!hasAudibleSignal(samples)) {
        return {
          text: "",
          durationMs: Math.max(0, now() - startedAt),
          model: paths.model ?? "",
          language: "es",
        };
      }

      let resultTimer: ReturnType<typeof setTimeout> | null = null;
      const resultTimeout = new Promise<never>((_, rejectPromise) => {
        resultTimer = setTimeout(() => {
          const error = new WhisperEngineError("transcription-failed", "Voxtype no termino la transcripcion a tiempo.");
          active?.stop(error);
          rejectPromise(error);
        }, inferenceTimeoutMs);
      });

      try {
        active.child.stdin.end(encodeVoxtypeAudio(samples));
      } catch (cause) {
        throw new WhisperEngineError(
          "transcription-failed",
          `Voxtype no pudo recibir el audio: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      const reply = await Promise.race([active.result, resultTimeout, aborted]).finally(() => {
        if (resultTimer) clearTimeout(resultTimer);
      });
      if (reply.ok !== true) {
        throw new WhisperEngineError(
          "transcription-failed",
          typeof reply.error === "string" ? reply.error : "Voxtype no pudo transcribir el audio.",
        );
      }

      return {
        text: normalizeWhisperTranscript(typeof reply.text === "string" ? reply.text : ""),
        durationMs: Math.max(0, now() - startedAt),
        model: paths.model ?? "",
        language: "es",
      };
    } catch (error) {
      const failure = error instanceof WhisperEngineError
        ? error
        : new WhisperEngineError("transcription-failed", error instanceof Error ? error.message : String(error));
      (active ?? worker)?.stop(failure);
      throw failure;
    } finally {
      transcribeOptions.signal?.removeEventListener("abort", onAbort);
      active?.stop(new WhisperEngineError("cancelled", "Worker de Voxtype finalizado."));
      transcribing = false;
    }
  }

  function cancelPending(): void {
    worker?.stop(new WhisperEngineError("cancelled", "Transcripcion de Voxtype cancelada."));
  }

  function dispose(): void {
    disposed = true;
    cancelPending();
  }

  return { status, ensureReady, transcribeWav, cancelPending, dispose };
}
