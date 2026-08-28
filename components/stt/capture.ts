import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SttSettings } from "./config";
import type { SttPaths } from "./paths";

/**
 * Captura de microfono cortada por Silero VAD.
 *
 * La grabacion ya no dura cuatro segundos fijos: arranca al pulsar el microfono
 * y termina cuando la persona lleva `silenceMs` callada, con un tope duro en
 * `maxDurationMs`. Si nunca hubo voz no se transcribe nada, que es la unica
 * forma de que Whisper no se invente frases sobre silencio.
 *
 * El grabador (`arecord`) y el analizador (`agenos-vad-capture`) son procesos
 * hijos encadenados por una tuberia: cancelar mata a los dos y suelta el
 * microfono de verdad.
 */

export type CapturePhase = "listening" | "speech";

export type CaptureOutcome =
  | { status: "speech"; wav: Uint8Array; durationMs: number; speechMs: number; reason: string }
  | { status: "no-speech"; durationMs: number; reason: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type CaptureHandle = {
  /** Se resuelve cuando la captura termina, por la razon que sea. */
  done: Promise<CaptureOutcome>;
  /** Cierra el microfono y deja que el VAD procese todo el audio recibido. */
  finish(): void;
  /** Mata grabador y analizador. La promesa acaba en `cancelled`. */
  cancel(): void;
};

export type StartCaptureOptions = {
  settings: SttSettings;
  paths: SttPaths;
  onPhase?: (phase: CapturePhase) => void;
  spawnFn?: typeof spawn;
  tempDir?: string;
  env?: Record<string, string | undefined>;
};

export type VadCaptureEvent = {
  event: string;
  speech?: boolean;
  reason?: string;
  durationMs?: number;
  speechMs?: number;
  message?: string;
};

/** Argumentos de `arecord` para PCM crudo a 16 kHz mono, que es lo que come el VAD. */
export function recorderArgs(settings: SttSettings): string[] {
  return [
    "-q",
    "-D", settings.captureDevice,
    "-t", "raw",
    "-f", "S16_LE",
    "-r", "16000",
    "-c", "1",
  ];
}

export function vadCaptureArgs(settings: SttSettings, vadModel: string, outPath: string): string[] {
  return [
    "--vad-model", vadModel,
    "--out", outPath,
    "--threads", String(Math.max(1, Math.min(4, settings.threads))),
    "--max-ms", String(settings.maxDurationMs),
    "--silence-ms", String(settings.silenceMs),
    "--min-speech-ms", String(settings.minSpeechMs),
    "--speech-pad-ms", String(settings.speechPadMs),
    "--start-timeout-ms", String(settings.startTimeoutMs),
    "--threshold", String(settings.vadThreshold),
  ];
}

/** Divide un stream en lineas NDJSON completas y devuelve el resto sin cerrar. */
export function parseVadEvents(buffer: string): { events: VadCaptureEvent[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const events: VadCaptureEvent[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as VadCaptureEvent);
    } catch {
      // El helper solo escribe NDJSON por stdout; cualquier otra cosa es ruido.
    }
  }

  return { events, rest };
}

export function captureUnavailableReason(paths: SttPaths): string | null {
  const missing: string[] = [];
  if (!paths.recorder) {
    missing.push("arecord");
  }
  if (!paths.vadCapture) {
    missing.push("agenos-vad-capture");
  }
  if (!paths.vadModel) {
    missing.push("el modelo de Silero VAD");
  }

  return missing.length === 0 ? null : `No se puede grabar: falta ${missing.join(" y ")}.`;
}

export function startVadCapture(options: StartCaptureOptions): CaptureHandle {
  const { settings, paths } = options;
  const spawnFn = options.spawnFn ?? spawn;
  const env = options.env ?? process.env;
  const baseTempDir = options.tempDir ?? tmpdir();

  let cancelled = false;
  let finishing = false;
  let recorder: ChildProcess | null = null;
  let analyzer: ChildProcess | null = null;

  const finishRecorder = () => {
    if (recorder && recorder.exitCode === null && recorder.signalCode === null) {
      recorder.kill("SIGTERM");
    }
  };

  const killAll = () => {
    for (const child of [recorder, analyzer]) {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  };

  const done = (async (): Promise<CaptureOutcome> => {
    const unavailable = captureUnavailableReason(paths);
    if (unavailable) {
      return { status: "failed", message: unavailable };
    }

    const workDir = await mkdtemp(join(baseTempDir, "agenos-stt-"));
    const outPath = join(workDir, "utterance.wav");

    try {
      if (cancelled) {
        return { status: "cancelled" };
      }

      recorder = spawnFn(paths.recorder as string, recorderArgs(settings), {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...env },
      });
      analyzer = spawnFn(paths.vadCapture as string, vadCaptureArgs(settings, paths.vadModel as string, outPath), {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...env },
      });

      recorder.stdout?.pipe(analyzer.stdin as NodeJS.WritableStream);
      // Un fallo de tuberia (el analizador cierra antes que el grabador) es el
      // final normal de la captura, no un error que deba tumbar el proceso.
      recorder.stdout?.on("error", () => {});
      analyzer.stdin?.on("error", () => {});

      // `finish()` puede llegar mientras mkdtemp o spawn siguen pendientes.
      // En ese caso cerramos arecord justo después de conectar la tubería.
      if (finishing) {
        finishRecorder();
      }

      let recorderError = "";
      let analyzerError = "";
      recorder.stderr?.on("data", (chunk: Buffer) => {
        recorderError += chunk.toString("utf8");
      });
      analyzer.stderr?.on("data", (chunk: Buffer) => {
        analyzerError += chunk.toString("utf8");
      });

      let outcome: VadCaptureEvent | null = null;
      let pending = "";
      analyzer.stdout?.on("data", (chunk: Buffer) => {
        const { events, rest } = parseVadEvents(pending + chunk.toString("utf8"));
        pending = rest;
        for (const event of events) {
          if (event.event === "listening") {
            options.onPhase?.("listening");
          } else if (event.event === "speech") {
            options.onPhase?.("speech");
          } else if (event.event === "done" || event.event === "error") {
            outcome = event;
          }
        }
      });

      const exitCode = await new Promise<number | null>((settle) => {
        let settled = false;
        const finish = (code: number | null) => {
          if (!settled) {
            settled = true;
            settle(code);
          }
        };

        analyzer?.on("error", () => finish(null));
        analyzer?.on("close", (code) => finish(code));
      });

      // El grabador sigue vivo cuando el analizador decide que la frase acabo.
      killAll();

      if (cancelled) {
        return { status: "cancelled" };
      }

      if (exitCode === 0 && outcome && (outcome as VadCaptureEvent).speech === true) {
        const wav = await readFile(outPath);
        const event = outcome as VadCaptureEvent;
        return {
          status: "speech",
          wav: new Uint8Array(wav),
          durationMs: event.durationMs ?? 0,
          speechMs: event.speechMs ?? 0,
          reason: event.reason ?? "silence",
        };
      }

      if (exitCode === 4) {
        const event = outcome as VadCaptureEvent | null;
        return {
          status: "no-speech",
          durationMs: event?.durationMs ?? 0,
          reason: event?.reason ?? "no-speech",
        };
      }

      const detail = [(outcome as VadCaptureEvent | null)?.message, analyzerError.trim(), recorderError.trim()]
        .filter(Boolean)
        .join(" ");

      return {
        status: "failed",
        message: detail || `La captura de audio termino con codigo ${exitCode ?? "desconocido"}.`,
      };
    } catch (error) {
      killAll();
      if (cancelled) {
        return { status: "cancelled" };
      }
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  })();

  return {
    done,
    finish() {
      finishing = true;
      finishRecorder();
    },
    cancel() {
      cancelled = true;
      killAll();
    },
  };
}
