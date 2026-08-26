import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { ApiMessageResponse, AudioStatus } from "../lib/system-types";

const execFile = promisify(execFileCallback);
const DEFAULT_SINK = "@DEFAULT_AUDIO_SINK@";

type CommandResult = { stdout: string; stderr?: string };

export type AudioServiceDependencies = {
  run(command: string, args: string[]): Promise<CommandResult>;
};

export function parseAudioStatus(output: string): AudioStatus {
  const match = output.match(/Volume:\s*([0-9]*\.?[0-9]+)/i);
  const volume = match ? Number.parseFloat(match[1] ?? "") : Number.NaN;
  if (!Number.isFinite(volume)) {
    return { available: false, volumePercent: null, muted: false };
  }

  return {
    available: true,
    volumePercent: Math.min(100, Math.max(0, Math.round(volume * 100))),
    muted: /\[MUTED\]/i.test(output),
  };
}

export function createAudioService(dependencies: Partial<AudioServiceDependencies> = {}) {
  const deps: AudioServiceDependencies = {
    run: dependencies.run ?? (async (command, args) => execFile(command, args)),
  };

  return {
    async getStatus(): Promise<AudioStatus> {
      try {
        return parseAudioStatus((await deps.run("wpctl", ["get-volume", DEFAULT_SINK])).stdout);
      } catch {
        return { available: false, volumePercent: null, muted: false };
      }
    },

    async setVolume(value: unknown): Promise<ApiMessageResponse> {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        return { ok: false, message: "El volumen debe estar entre el 0 % y el 100 %." };
      }

      const percent = Math.round(value);
      try {
        await deps.run("wpctl", ["set-volume", "-l", "1.0", DEFAULT_SINK, `${percent}%`]);
        return { ok: true, message: `Volumen ajustado al ${percent} %.` };
      } catch {
        return { ok: false, message: "Este equipo no permite cambiar el volumen desde AgenOS." };
      }
    },

    async setMuted(value: unknown): Promise<ApiMessageResponse> {
      if (typeof value !== "boolean") {
        return { ok: false, message: "El estado de silencio no es válido." };
      }

      try {
        await deps.run("wpctl", ["set-mute", DEFAULT_SINK, value ? "1" : "0"]);
        return { ok: true, message: value ? "Sonido silenciado." : "Sonido activado." };
      } catch {
        return { ok: false, message: "Este equipo no permite silenciar el sonido desde AgenOS." };
      }
    },
  };
}
