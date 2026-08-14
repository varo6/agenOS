import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  "/opt/agenos/system/whisper.cpp/models/ggml-base.bin",
];

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
  const normalized = line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /^\[(musica|music|silencio|silence|aplausos|applause|ruido|noise|sonido)\]$/.test(normalized);
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
      missing.push("modelo ggml-base.bin");
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

    const lang = input.lang?.trim() || "es";
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

      const transcription = await runCommand(binary, [
        "-m",
        model,
        "-f",
        wavPath,
        "-l",
        lang,
        "-t",
        String(threads),
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
