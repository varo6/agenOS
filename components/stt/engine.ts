import { spawn, type ChildProcess } from "node:child_process";

import type { SttSettings } from "./config";
import type { SttPaths } from "./paths";

/**
 * Fallback mediante whisper-server.
 *
 * whisper-server es el fallback explicito. Carga el modelo una sola vez,
 * escucha solo en loopback y este modulo lo arranca bajo demanda.
 *
 * Electron y la ruta HTTP hablan con el mismo servidor y le mandan exactamente
 * los mismos parametros, asi que las dos rutas transcriben igual.
 */

export type SttEngineName = "whisper.cpp" | "voxtype";

export type WhisperEngineStatus = {
  available: boolean;
  reason: string | null;
  model: string | null;
  vadModel: string | null;
  baseUrl: string;
  engine: SttEngineName;
};

export type TranscribeWavOptions = {
  /** Se ignora si el motor no esta listo; lo normal es dejar el default. */
  audioContext?: number;
  signal?: AbortSignal;
};

export type TranscribeWavResult = {
  text: string;
  durationMs: number;
  model: string;
  language: "es";
};

export type WhisperEngine = {
  status(): WhisperEngineStatus;
  ensureReady(): Promise<void>;
  transcribeWav(wav: Uint8Array, options?: TranscribeWavOptions): Promise<TranscribeWavResult>;
  /** Libera una precarga que ya no se usara, por ejemplo si no hubo voz. */
  cancelPending?(): void;
  dispose(): void;
};

export type WhisperEngineOptions = {
  settings: SttSettings;
  paths: SttPaths;
  baseUrl: string;
  fetchFn?: typeof fetch;
  spawnFn?: typeof spawn;
  env?: Record<string, string | undefined>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: (message: string) => void;
};

const PROBE_TIMEOUT_MS = 1_000;
const START_TIMEOUT_MS = 60_000;
const START_POLL_MS = 200;
const INFERENCE_TIMEOUT_MS = 120_000;

export class WhisperEngineError extends Error {
  readonly code: "unavailable" | "busy" | "cancelled" | "transcription-failed";

  constructor(code: "unavailable" | "busy" | "cancelled" | "transcription-failed", message: string) {
    super(message);
    this.name = "WhisperEngineError";
    this.code = code;
  }
}

/**
 * Argumentos con los que arranca whisper-server cuando se pide el fallback.
 *
 * Los parametros del VAD no van aqui: en whisper.cpp v1.7.6 el flag
 * `--vad-min-silence-duration-ms` escribe por error sobre
 * vad_min_speech_duration_ms. Por peticion el mapeo si es correcto, asi que
 * viajan en el multipart de /inference.
 */
export function whisperServerArgs(settings: SttSettings, paths: SttPaths): string[] {
  return [
    "-m", paths.model ?? "",
    "--host", settings.fallbackServerHost,
    "--port", String(settings.fallbackServerPort),
    "-t", String(settings.threads),
    "-l", settings.language,
    "-bs", String(settings.fallbackBeamSize),
    "-bo", String(settings.fallbackBestOf),
    ...(settings.fallbackSuppressNonSpeech ? ["--suppress-nst"] : []),
    ...(settings.fallbackAudioContext > 0 ? ["-ac", String(settings.fallbackAudioContext)] : []),
    "--vad",
    "-vm", paths.vadModel ?? "",
    "--no-gpu",
  ];
}

/** Campos del multipart de /inference. Mismos para Electron y para HTTP. */
export function inferenceFields(
  settings: SttSettings,
  audioContext: number,
): Record<string, string> {
  return {
    response_format: "json",
    language: settings.language,
    temperature: "0",
    temperature_inc: "0.2",
    beam_size: String(settings.fallbackBeamSize),
    best_of: String(settings.fallbackBestOf),
    audio_ctx: String(audioContext),
    suppress_nst: String(settings.fallbackSuppressNonSpeech),
    no_timestamps: "false",
    no_context: "true",
    vad: "true",
    vad_threshold: String(settings.vadThreshold),
    vad_min_speech_duration_ms: String(settings.minSpeechMs),
    vad_min_silence_duration_ms: String(settings.silenceMs),
    vad_speech_pad_ms: String(settings.speechPadMs),
  };
}

/**
 * Whisper marca lo que no es habla entre corchetes o parentesis y la lista de
 * etiquetas no es cerrada: sobre ruido llega a emitir [Pausa], [BLANK_AUDIO] o
 * [Ruido de fondo]. Una orden de voz real nunca es solo eso.
 */
export function normalizeWhisperTranscript(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("whisper_") && !line.startsWith("main:") && !isNonSpeechLine(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonSpeechLine(line: string): boolean {
  return /^[[(][^\])]*[\])]$/.test(line.trim());
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function createWhisperEngine(options: WhisperEngineOptions): WhisperEngine {
  const { settings, paths, baseUrl } = options;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const spawnFn = options.spawnFn ?? spawn;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const log = options.logger ?? (() => {});

  let child: ChildProcess | null = null;
  let starting: Promise<void> | null = null;
  let disposed = false;

  function status(): WhisperEngineStatus {
    return {
      available: paths.missing.length === 0,
      reason: paths.missing.length === 0
        ? null
        : `STT local no disponible: falta ${paths.missing.join(" y ")}.`,
      model: paths.model,
      vadModel: paths.vadModel,
      baseUrl,
      engine: "whisper.cpp",
    };
  }

  async function isUp(): Promise<boolean> {
    try {
      const response = await fetchFn(`${baseUrl}/`, {
        method: "GET",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      // Cualquier respuesta HTTP significa que el proceso escucha y, por como
      // arranca whisper-server, que ya tiene el modelo cargado.
      return response.status > 0;
    } catch {
      return false;
    }
  }

  function spawnServer(): void {
    if (!paths.server || !paths.model || !paths.vadModel) {
      throw new WhisperEngineError("unavailable", status().reason ?? "STT local no disponible.");
    }

    log(`Arrancando el fallback whisper-server en ${baseUrl}.`);
    child = spawnFn(paths.server, whisperServerArgs(settings, paths), {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...env },
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        log(line);
      }
    });
    child.on("exit", (code) => {
      log(`whisper-server termino con codigo ${code ?? "desconocido"}.`);
      child = null;
    });
    child.unref?.();
  }

  async function ensureReady(): Promise<void> {
    if (disposed) {
      throw new WhisperEngineError("unavailable", "El motor de STT local ya se ha cerrado.");
    }

    if (await isUp()) {
      return;
    }

    if (starting) {
      return starting;
    }

    const missing = status();
    if (!missing.available) {
      throw new WhisperEngineError("unavailable", missing.reason ?? "STT local no disponible.");
    }

    if (!settings.fallbackServerAutostart) {
      throw new WhisperEngineError(
        "unavailable",
        `whisper-server no responde en ${baseUrl} y el arranque automatico esta desactivado.`,
      );
    }

    starting = (async () => {
      if (!child) {
        spawnServer();
      }

      const deadline = now() + START_TIMEOUT_MS;
      while (now() < deadline) {
        if (await isUp()) {
          return;
        }
        await sleep(START_POLL_MS);
      }

      throw new WhisperEngineError(
        "unavailable",
        `whisper-server no llego a responder en ${baseUrl}.`,
      );
    })().finally(() => {
      starting = null;
    });

    return starting;
  }

  async function transcribeWav(
    wav: Uint8Array,
    transcribeOptions: TranscribeWavOptions = {},
  ): Promise<TranscribeWavResult> {
    await ensureReady();

    const audioContext = transcribeOptions.audioContext ?? settings.fallbackAudioContext;
    const startedAt = now();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "utterance.wav");
    for (const [key, value] of Object.entries(inferenceFields(settings, audioContext))) {
      form.append(key, value);
    }

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/inference`, {
        method: "POST",
        body: form,
        signal: transcribeOptions.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new WhisperEngineError(
        "transcription-failed",
        `whisper-server no respondio: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new WhisperEngineError(
        "transcription-failed",
        `whisper-server devolvio ${response.status}.`,
      );
    }

    const payload = await response.json() as { text?: unknown; error?: unknown };
    if (typeof payload.error === "string" && payload.error) {
      throw new WhisperEngineError("transcription-failed", payload.error);
    }

    return {
      text: normalizeWhisperTranscript(typeof payload.text === "string" ? payload.text : ""),
      durationMs: Math.max(0, now() - startedAt),
      model: paths.model ?? "",
      language: "es",
    };
  }

  function dispose(): void {
    disposed = true;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    }
    child = null;
  }

  return { status, ensureReady, transcribeWav, dispose };
}
