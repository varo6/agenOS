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
};

type WorkerReply = {
  ok?: boolean;
  text?: unknown;
  language?: unknown;
  error?: unknown;
};

type Worker = {
  child: ChildProcess;
  ready: Promise<void>;
  result: Promise<WorkerReply>;
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

  let worker: Worker | null = null;
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

    const child = spawnFn(paths.voxtype, voxtypeWorkerArgs(settings, paths.model), {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...env },
    });

    let stdoutBuffer = "";
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let resultResolve!: (reply: WorkerReply) => void;
    let resultReject!: (error: Error) => void;
    let sawReady = false;
    let sawResult = false;

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

    const startTimer = setTimeout(() => {
      if (!sawReady) {
        const error = new WhisperEngineError("unavailable", "Voxtype no cargo el modelo a tiempo.");
        readyReject(error);
        resultReject(error);
        child.kill("SIGKILL");
      }
    }, START_TIMEOUT_MS);

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
          sawResult = true;
          resultResolve(JSON.parse(line) as WorkerReply);
        } catch {
          // Voxtype solo publica una linea JSON; el resto es salida de diagnostico.
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        log(line);
      }
    });
    child.on("error", (cause) => {
      clearTimeout(startTimer);
      const error = new WhisperEngineError("unavailable", `No se pudo arrancar Voxtype: ${cause.message}`);
      if (!sawReady) readyReject(error);
      if (!sawResult) resultReject(error);
    });
    child.on("close", (code) => {
      clearTimeout(startTimer);
      const error = new WhisperEngineError(
        sawReady ? "transcription-failed" : "unavailable",
        `Voxtype termino con codigo ${code ?? "desconocido"}.`,
      );
      if (!sawReady) readyReject(error);
      if (!sawResult) resultReject(error);
      if (worker?.child === child) {
        worker = null;
      }
    });

    return { child, ready, result };
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
    await ensureReady();
    const active = worker;
    if (!active || !active.child.stdin) {
      throw new WhisperEngineError("transcription-failed", "Voxtype perdio el proceso de transcripcion.");
    }

    const startedAt = now();
    const samples = wavToFloat32(wav);
    if (!hasAudibleSignal(samples)) {
      cancelPending();
      return {
        text: "",
        durationMs: Math.max(0, now() - startedAt),
        model: paths.model ?? "",
        language: transcribeOptions.language?.trim() || settings.language,
      };
    }
    let resultTimer: ReturnType<typeof setTimeout> | null = null;
    const resultTimeout = new Promise<never>((_, rejectPromise) => {
      resultTimer = setTimeout(() => {
        active.child.kill("SIGKILL");
        rejectPromise(new WhisperEngineError("transcription-failed", "Voxtype no termino la transcripcion a tiempo."));
      }, INFERENCE_TIMEOUT_MS);
    });

    active.child.stdin.end(encodeVoxtypeAudio(samples));
    const reply = await Promise.race([active.result, resultTimeout]).finally(() => {
      if (resultTimer) clearTimeout(resultTimer);
    });
    if (worker?.child === active.child) {
      worker = null;
    }
    if (reply.ok !== true) {
      throw new WhisperEngineError(
        "transcription-failed",
        typeof reply.error === "string" ? reply.error : "Voxtype no pudo transcribir el audio.",
      );
    }

    const language = typeof reply.language === "string"
      ? reply.language
      : transcribeOptions.language?.trim() || settings.language;
    return {
      text: normalizeWhisperTranscript(typeof reply.text === "string" ? reply.text : ""),
      durationMs: Math.max(0, now() - startedAt),
      model: paths.model ?? "",
      language,
    };
  }

  function cancelPending(): void {
    if (worker?.child.exitCode === null) {
      worker.child.kill("SIGKILL");
    }
    worker = null;
  }

  function dispose(): void {
    disposed = true;
    cancelPending();
  }

  return { status, ensureReady, transcribeWav, cancelPending, dispose };
}
