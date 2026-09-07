import { spawn, type ChildProcess } from "node:child_process";

import type { TtsPaths } from "./paths";

/** Reproduce WAV por stdin con aplay, incluido en alsa-utils. */

export type WavPlayerFailureCode = "unavailable" | "cancelled" | "synthesis-failed";

export type PlayResult =
  | { ok: true }
  | { ok: false; code: WavPlayerFailureCode; message: string };

export type WavPlayer = {
  available(): boolean;
  reason(): string | null;
  play(wav: Uint8Array): Promise<PlayResult>;
  stop(): void;
  isPlaying(): boolean;
};

type SpawnedPlayer = ChildProcess & {
  stdin: NodeJS.WritableStream;
  stderr: NodeJS.ReadableStream & { setEncoding(encoding: BufferEncoding): void };
};

export type WavPlayerOptions = {
  paths: TtsPaths;
  spawnFn?: (command: string, args: string[], options: { stdio: "pipe" }) => SpawnedPlayer;
};

const MISSING_PLAYER_REASON =
  "No se puede reproducir la voz de la nube: falta aplay (paquete alsa-utils).";

export function createWavPlayer(options: WavPlayerOptions): WavPlayer {
  const binary = options.paths.player;
  let active: SpawnedPlayer | null = null;

  function stop(): void {
    const child = active;
    if (!child || child.killed) {
      return;
    }

    // Si SIGTERM no detiene la reproducción, fuerza la salida tras 750 ms.
    child.kill("SIGTERM");
    setTimeout(() => {
      if (active === child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 750).unref();
  }

  async function play(wav: Uint8Array): Promise<PlayResult> {
    if (!binary) {
      return { ok: false, code: "unavailable", message: MISSING_PLAYER_REASON };
    }
    if (wav.byteLength === 0) {
      return { ok: true };
    }

    stop();

    return new Promise<PlayResult>((resolve) => {
      const spawnPlayer = options.spawnFn
        ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions) as SpawnedPlayer);

      let child: SpawnedPlayer;
      try {
        // `-` es stdin. No se le pasan formato ni frecuencia: el WAV trae
        // cabecera RIFF y aplay la lee, asi que cambiar de voz o de calidad en
        // Azure no obliga a tocar nada aqui.
        child = spawnPlayer(binary, ["-q", "-"], { stdio: "pipe" });
      } catch (error) {
        resolve({
          ok: false,
          code: "synthesis-failed",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }

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
          resolve({ ok: true });
          return;
        }

        const detail = stderr.trim();
        resolve({
          ok: false,
          code: "synthesis-failed",
          message: detail || `aplay termino con codigo ${code ?? "desconocido"}.`,
        });
      });

      // Si el proceso ya ha muerto, escribir en su stdin lanza EPIPE y tumbaria
      // el proceso principal de Electron.
      child.stdin.on("error", () => {});
      child.stdin.end(Buffer.from(wav));
    });
  }

  return {
    available: () => Boolean(binary),
    reason: () => (binary ? null : MISSING_PLAYER_REASON),
    play,
    stop,
    isPlaying: () => active !== null,
  };
}
