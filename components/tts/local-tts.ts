import { spawn, type ChildProcess } from "node:child_process";

import type { TtsSettings } from "./config";
import type { TtsPaths } from "./paths";

export type LocalTtsFailureCode = "unavailable" | "cancelled" | "synthesis-failed";

export type LocalTtsResult =
  | { ok: true; engine: "espeak-ng"; voice: string }
  | { ok: false; code: LocalTtsFailureCode; message: string };

export type LocalTtsService = {
  status(): { available: boolean; reason: string | null; engine: "espeak-ng"; voice: string };
  speak(text: string): Promise<LocalTtsResult>;
  stop(): void;
  isSpeaking(): boolean;
};

export type LocalTtsOptions = {
  spawnFn?: (command: string, args: string[], options: { stdio: "pipe" }) => SpawnedTtsProcess;
};

type SpawnedTtsProcess = ChildProcess & {
  stdin: NodeJS.WritableStream;
  stderr: NodeJS.ReadableStream & { setEncoding(encoding: BufferEncoding): void };
};

function normalizeText(text: string, maxChars: number): string {
  return text
    .replace(/```[\s\S]*?```/g, " bloque de codigo ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_#>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export function createLocalTtsService(
  settings: TtsSettings,
  paths: TtsPaths,
  options: LocalTtsOptions = {},
): LocalTtsService {
  let active: SpawnedTtsProcess | null = null;

  function status() {
    return {
      available: Boolean(paths.binary),
      reason: paths.binary ? null : "TTS local no disponible: falta espeak-ng.",
      engine: paths.engine,
      voice: settings.voice,
    };
  }

  function stop() {
    const child = active;
    if (!child || child.killed) {
      return;
    }

    child.kill("SIGTERM");
    setTimeout(() => {
      if (active === child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 750).unref();
  }

  async function speak(text: string): Promise<LocalTtsResult> {
    const current = status();
    const binary = paths.binary;
    if (!current.available || !binary) {
      return { ok: false, code: "unavailable", message: current.reason ?? "TTS local no disponible." };
    }

    const normalized = normalizeText(text, settings.maxChars);
    if (!normalized) {
      return { ok: true, engine: paths.engine, voice: settings.voice };
    }

    stop();

    return new Promise<LocalTtsResult>((resolve) => {
      const child = (options.spawnFn ?? ((command, args, spawnOptions) => (
        spawn(command, args, spawnOptions) as SpawnedTtsProcess
      )))(binary, [
        "-v", settings.voice,
        "-s", String(settings.rate),
        "-p", String(settings.pitch),
        "-a", String(settings.amplitude),
        "--stdin",
      ], { stdio: "pipe" });

      active = child;

      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        if (active === child) {
          active = null;
        }
        resolve({ ok: false, code: "synthesis-failed", message: error.message });
      });

      child.on("exit", (code, signal) => {
        if (active === child) {
          active = null;
        }

        if (signal) {
          resolve({ ok: false, code: "cancelled", message: "Lectura cancelada." });
          return;
        }
        if (code === 0) {
          resolve({ ok: true, engine: paths.engine, voice: settings.voice });
          return;
        }

        const detail = stderr.trim();
        resolve({
          ok: false,
          code: "synthesis-failed",
          message: detail || `espeak-ng termino con codigo ${code ?? "desconocido"}.`,
        });
      });

      child.stdin.end(normalized);
    });
  }

  return {
    status,
    speak,
    stop,
    isSpeaking() {
      return active !== null;
    },
  };
}
