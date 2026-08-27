import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WhisperEngineError, type SttEngineName } from "../../../../stt/engine";
import { createSttRuntime, type SttRuntime } from "../../../../stt/runtime";

/**
 * Ruta HTTP del STT local.
 *
 * Habla con el mismo motor que Electron y le manda los mismos parametros, asi
 * que una frase transcribe igual venga del navegador o
 * del proceso principal. Lo unico que hace de mas es convertir a WAV de 16 kHz
 * lo que llega del navegador, que graba webm/ogg.
 */

export type SttEngine = SttEngineName;

export type SttStatusResponse = {
  ok: true;
  available: boolean;
  engine: SttEngine | null;
  model: string | null;
  reason: string | null;
  /** Tope de captura que debe respetar el cliente web, en milisegundos. */
  maxDurationMs: number;
};

export type SttTranscribeInput = {
  audio: Uint8Array;
  contentType: string;
  signal?: AbortSignal;
};

export type SttFailureCode =
  | "unavailable"
  | "busy"
  | "cancelled"
  | "unsupported-media"
  | "no-speech"
  | "transcription-failed";

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
  tempDir?: string;
  now?: () => number;
  /** Inyectable para poder probar la ruta HTTP sin levantar el motor real. */
  runtime?: SttRuntime;
};

export type SttService = {
  status(): SttStatusResponse;
  transcribe(input: SttTranscribeInput): Promise<SttTranscribeResponse>;
  dispose(): void;
};

const NO_SPEECH_MESSAGE = "No se detecto voz. Intentalo otra vez o usa texto.";

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

type AudioFormat = "wav" | "webm" | "ogg";

export function detectAudioFormat(contentType: string): AudioFormat | null {
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

/** ffmpeg a 16 kHz mono, que es lo unico que Whisper acepta sin remuestrear. */
export function ffmpegArgs(inputPath: string, outputPath: string, maxDurationMs: number): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    // El tope de duracion se aplica aqui tambien: un cliente que ignore el
    // limite no puede colarle a Whisper diez minutos de audio.
    "-t",
    (maxDurationMs / 1000).toFixed(3),
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "wav",
    outputPath,
  ];
}

export function createSttService(options: SttServiceOptions = {}): SttService {
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? defaultSttCommandRunner;
  const tempDir = options.tempDir ?? tmpdir();
  const now = options.now ?? (() => Date.now());
  const runtime = options.runtime ?? createSttRuntime({ env });

  function status(): SttStatusResponse {
    const engineStatus = runtime.engine.status();

    return {
      ok: true,
      available: engineStatus.available,
      engine: engineStatus.available ? engineStatus.engine : null,
      model: engineStatus.model,
      reason: engineStatus.reason,
      maxDurationMs: runtime.settings.maxDurationMs,
    };
  }

  async function transcribe(input: SttTranscribeInput): Promise<SttTranscribeResponse> {
    const current = status();
    if (!current.available) {
      return { ok: false, code: "unavailable", message: current.reason ?? "STT local no disponible." };
    }

    const format = detectAudioFormat(input.contentType);
    if (!format) {
      return {
        ok: false,
        code: "unsupported-media",
        message: `Formato de audio no soportado: ${input.contentType || "desconocido"}. Usa audio/wav, audio/webm o audio/ogg.`,
      };
    }

    if (format !== "wav" && !runtime.paths.ffmpeg) {
      return {
        ok: false,
        code: "unavailable",
        message: "STT local no puede convertir el audio: falta ffmpeg.",
      };
    }

    const startedAt = now();
    const workDir = await mkdtemp(join(tempDir, "agenos-stt-http-"));
    const inputPath = join(workDir, `utterance.${format}`);
    const wavPath = format === "wav" ? inputPath : join(workDir, "utterance-16k.wav");

    try {
      await writeFile(inputPath, input.audio);

      if (format !== "wav" && runtime.paths.ffmpeg) {
        await runCommand(
          runtime.paths.ffmpeg,
          ffmpegArgs(inputPath, wavPath, runtime.settings.maxDurationMs),
          { timeoutMs: 15_000 },
        );
      }

      const wav = await readFile(wavPath);
      const transcription = await runtime.engine.transcribeWav(new Uint8Array(wav), { signal: input.signal });

      // El motor devuelve vacio si no encuentra habla; la ruta HTTP lo conserva
      // como un 422 tipado en vez de inventar una frase.
      if (!transcription.text) {
        return { ok: false, code: "no-speech", message: NO_SPEECH_MESSAGE };
      }

      return {
        ok: true,
        text: transcription.text,
        durationMs: Math.max(0, now() - startedAt),
        engine: runtime.engine.status().engine,
        model: transcription.model,
      };
    } catch (error) {
      const engineCode = error instanceof WhisperEngineError ? error.code : null;
      const unavailable = engineCode === "unavailable";
      const message = error instanceof Error ? error.message : String(error);

      return {
        ok: false,
        code: engineCode === "busy" || engineCode === "cancelled"
          ? engineCode
          : unavailable ? "unavailable" : "transcription-failed",
        message: unavailable ? message : `No se pudo transcribir el audio: ${message}`,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  return {
    status,
    transcribe,
    dispose() {
      runtime.engine.dispose();
    },
  };
}
