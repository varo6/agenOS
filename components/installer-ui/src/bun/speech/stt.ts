import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type SttEngine = "whisper.cpp";

export type SttStatusResponse = {
  ok: true;
  available: boolean;
  engine: SttEngine | null;
  model: string | null;
  reason: string | null;
};

export type SttTranscribeInput = {
  audio: Uint8Array;
  contentType: string;
  lang?: string;
};

export type SttFailureCode = "unavailable" | "unsupported-media" | "transcription-failed";

export type SttTranscribeResponse =
  | { ok: true; text: string; durationMs: number; engine: SttEngine; model: string }
  | { ok: false; code: SttFailureCode; message: string };

export type SttCommandResult = {
  stdout: string;
  stderr: string;
};

export type SttCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
) => Promise<SttCommandResult>;

export type SttServiceOptions = {
  env?: NodeJS.ProcessEnv;
  runCommand?: SttCommandRunner;
  pathExists?: (path: string) => boolean;
  readCpuInfo?: () => string;
  tempDir?: string;
  now?: () => number;
};

export type SttService = {
  status(): SttStatusResponse;
  transcribe(input: SttTranscribeInput): Promise<SttTranscribeResponse>;
};

const WHISPER_SIMD_CANDIDATES = [
  "/opt/agenos/system/whisper.cpp/whisper-cli",
  "/usr/local/bin/whisper-cli",
  "/usr/bin/whisper-cli",
];

const WHISPER_BASELINE_CANDIDATES = [
  "/opt/agenos/system/whisper.cpp/whisper-cli-baseline",
];

const WHISPER_MODEL_CANDIDATES = [
  "/opt/agenos/system/whisper.cpp/models/ggml-small.bin",
];

/** AgenOS transcribe en espanol; el idioma nunca se autodetecta. */
const DEFAULT_STT_LANGUAGE = "es";

const FFMPEG_CANDIDATES = [
  "/usr/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
];

const REQUIRED_SIMD_FLAGS = ["sse4_2", "avx", "avx2", "fma", "f16c", "bmi2"];

export function defaultSttCommandRunner(
  command: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<SttCommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        rejectPromise(new Error(`${command} supero el tiempo maximo de ${options.timeoutMs}ms.`));
      }
    }, options.timeoutMs);

    const finish = (error: Error | null, result?: SttCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise(result as SttCommandResult);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };

      if (code === 0) {
        finish(null, result);
        return;
      }

      const detail = result.stderr.trim() || result.stdout.trim();
      finish(new Error(`${command} termino con codigo ${code ?? 1}${detail ? `: ${detail}` : "."}`));
    });
  });
}

export function normalizeWhisperTranscript(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("whisper_") && !line.startsWith("main:") && !isNonSpeechTranscript(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonSpeechTranscript(line: string): boolean {
  // Whisper marca lo que no es habla entre corchetes o parentesis y la lista de
  // etiquetas posibles no es cerrada: sobre ruido puro llega a emitir [Pausa],
  // [BLANK_AUDIO] o [Ruido de fondo]. Una orden de voz real nunca es solo eso,
  // asi que descartamos cualquier linea que sea unicamente un marcador.
  return /^[[(][^\])]*[\])]$/.test(line.trim());
}

/**
 * Whisper codifica siempre una ventana de 30 s, aunque la frase dure cuatro. En
 * un portatil modesto eso multiplica por cinco el tiempo del encoder para
 * analizar silencio de relleno. Recortando el contexto de audio a lo grabado,
 * mas holgura, `small` sale mas rapido que el `base` anterior a ventana
 * completa. Devuelve 0 (= ventana entera) cuando no hay nada que recortar.
 */
export function resolveAudioContext(seconds: number): number {
  const FULL_WINDOW_TOKENS = 1500;
  const TOKENS_PER_SECOND = FULL_WINDOW_TOKENS / 30;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }

  const needed = seconds * TOKENS_PER_SECOND * 1.5 + 64;
  const rounded = Math.ceil(needed / 64) * 64;

  return rounded >= FULL_WINDOW_TOKENS ? 0 : Math.max(256, rounded);
}

/**
 * Duracion real de un WAV a partir de su cabecera. El audio llega del navegador
 * y no siempre pasa por ffmpeg, asi que no se puede asumir 16 kHz mono. Devuelve
 * 0 si la cabecera no se entiende, que se traduce en ventana completa: preferimos
 * transcribir lento a recortar audio de mas y perder el final de la frase.
 */
export function readWavDurationSeconds(header: Uint8Array): number {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const ascii = (offset: number) =>
    String.fromCharCode(...header.subarray(offset, offset + 4));

  if (header.byteLength < 44 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") {
    return 0;
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let offset = 12;

  while (offset + 8 <= header.byteLength) {
    const chunkId = ascii(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (chunkId === "fmt " && body + 16 <= header.byteLength) {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === "data") {
      const bytesPerFrame = channels * Math.ceil(bitsPerSample / 8);
      if (bytesPerFrame <= 0 || sampleRate <= 0) {
        return 0;
      }
      // El tamano declarado puede mentir en streams truncados; el real manda.
      const dataBytes = Math.min(chunkSize, Math.max(0, header.byteLength - body));
      return dataBytes / (sampleRate * bytesPerFrame);
    }

    // Los chunks impares llevan un byte de relleno que no cuenta en chunkSize.
    offset = body + chunkSize + (chunkSize % 2);
  }

  return 0;
}

type AudioFormat = "wav" | "webm" | "ogg";

function detectAudioFormat(contentType: string): AudioFormat | null {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized === "audio/wav" || normalized === "audio/x-wav" || normalized === "audio/wave") {
    return "wav";
  }
  if (normalized === "audio/webm" || normalized === "video/webm") {
    return "webm";
  }
  if (normalized === "audio/ogg" || normalized === "application/ogg") {
    return "ogg";
  }
  return null;
}

export function createSttService(options: SttServiceOptions = {}): SttService {
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? defaultSttCommandRunner;
  const pathExists = options.pathExists ?? existsSync;
  const readCpuInfo = options.readCpuInfo ?? (() => readFileSync("/proc/cpuinfo", "utf8"));
  const tempDir = options.tempDir ?? tmpdir();
  const now = options.now ?? (() => Date.now());

  function cpuSupportsSimd(): boolean {
    if (env.AGENOS_STT_FORCE_BASELINE?.trim() === "1") {
      return false;
    }

    if (process.platform !== "linux" || process.arch !== "x64") {
      return true;
    }

    try {
      const flagsLine = readCpuInfo()
        .toLowerCase()
        .split(/\r?\n/)
        .find((line) => line.startsWith("flags"));
      const flags = new Set((flagsLine?.split(":")[1] ?? "").trim().split(/\s+/));

      return REQUIRED_SIMD_FLAGS.every((flag) => flags.has(flag));
    } catch {
      return true;
    }
  }

  function firstExistingPath(candidates: (string | null | undefined)[]): string | null {
    for (const candidate of candidates) {
      if (candidate && pathExists(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function resolveWhisperBinary(): string | null {
    const configured = env.AGENOS_WHISPER_CPP_BIN?.trim();
    if (configured) {
      return pathExists(configured) ? configured : null;
    }

    const ordered = cpuSupportsSimd()
      ? [...WHISPER_SIMD_CANDIDATES, ...WHISPER_BASELINE_CANDIDATES]
      : [...WHISPER_BASELINE_CANDIDATES, ...WHISPER_SIMD_CANDIDATES];

    return firstExistingPath(ordered);
  }

  function resolveModel(): string | null {
    const configured = env.AGENOS_WHISPER_MODEL?.trim();
    if (configured) {
      return pathExists(configured) ? resolve(configured) : null;
    }

    return firstExistingPath(WHISPER_MODEL_CANDIDATES);
  }

  /**
   * El default de whisper-cli es ingles y `auto` se equivoca a menudo en frases
   * cortas, asi que un `lang` ausente, vacio o "auto" cae siempre en espanol.
   * Una etiqueta regional ("es-ES") se reduce a su idioma base.
   */
  function resolveLanguage(requested: string | undefined): string {
    const fallback = env.AGENOS_STT_LANGUAGE?.trim().toLowerCase() || DEFAULT_STT_LANGUAGE;
    const normalized = requested?.trim().toLowerCase();
    if (!normalized || normalized === "auto") {
      return fallback;
    }

    return normalized.split(/[-_]/)[0] || fallback;
  }

  /** Un wav ilegible no debe tumbar la transcripcion: 0 significa ventana entera. */
  async function readWavDuration(path: string): Promise<number> {
    try {
      return readWavDurationSeconds(await readFile(path));
    } catch {
      return 0;
    }
  }

  function resolveFfmpeg(): string | null {
    const configured = env.AGENOS_FFMPEG_BIN?.trim();
    if (configured) {
      return pathExists(configured) ? configured : null;
    }

    return firstExistingPath(FFMPEG_CANDIDATES);
  }

  function status(): SttStatusResponse {
    const binary = resolveWhisperBinary();
    const model = resolveModel();
    const missing: string[] = [];
    if (!binary) {
      missing.push("whisper-cli");
    }
    if (!model) {
      missing.push("modelo ggml-small.bin");
    }

    return {
      ok: true,
      available: missing.length === 0,
      engine: missing.length === 0 ? "whisper.cpp" : null,
      model,
      reason: missing.length === 0 ? null : `STT local no disponible: falta ${missing.join(" y ")}.`,
    };
  }

  async function transcribe(input: SttTranscribeInput): Promise<SttTranscribeResponse> {
    const binary = resolveWhisperBinary();
    const model = resolveModel();
    if (!binary || !model) {
      return {
        ok: false,
        code: "unavailable",
        message: status().reason ?? "STT local no disponible.",
      };
    }

    const format = detectAudioFormat(input.contentType);
    if (!format) {
      return {
        ok: false,
        code: "unsupported-media",
        message: `Formato de audio no soportado: ${input.contentType || "desconocido"}. Usa audio/wav, audio/webm o audio/ogg.`,
      };
    }

    const ffmpeg = resolveFfmpeg();
    if (format !== "wav" && !ffmpeg) {
      return {
        ok: false,
        code: "unavailable",
        message: "STT local no puede convertir el audio: falta ffmpeg.",
      };
    }

    const lang = resolveLanguage(input.lang);
    const threads = Math.max(1, Math.min(4, cpus().length || 4));
    const startedAt = now();
    const workDir = await mkdtemp(join(tempDir, "agenos-stt-http-"));
    const inputPath = join(workDir, `utterance.${format}`);
    const wavPath = format === "wav" ? inputPath : join(workDir, "utterance-16k.wav");

    try {
      await writeFile(inputPath, input.audio);

      if (format !== "wav" && ffmpeg) {
        await runCommand(ffmpeg, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          inputPath,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "wav",
          wavPath,
        ], { timeoutMs: 15_000 });
      }

      const audioContext = resolveAudioContext(await readWavDuration(wavPath));
      const transcription = await runCommand(binary, [
        "-m",
        model,
        "-f",
        wavPath,
        "-l",
        lang,
        "-t",
        String(threads),
        ...(audioContext > 0 ? ["-ac", String(audioContext)] : []),
        "-nt",
        "-np",
      ], {
        timeoutMs: 60_000,
        env: {
          LD_LIBRARY_PATH: [
            resolve(binary, "..", "lib"),
            env.LD_LIBRARY_PATH,
          ].filter(Boolean).join(":"),
        },
      });

      return {
        ok: true,
        text: normalizeWhisperTranscript(transcription.stdout),
        durationMs: Math.max(0, now() - startedAt),
        engine: "whisper.cpp",
        model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: "transcription-failed",
        message: `No se pudo transcribir el audio: ${message}`,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  return { status, transcribe };
}
