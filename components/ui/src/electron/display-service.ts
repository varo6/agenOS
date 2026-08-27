import { execFile as execFileCallback, spawn as spawnProcess } from "node:child_process";
import { promisify } from "node:util";

import type { ApiMessageResponse, DisplayStatus } from "../lib/system-types";

const execFile = promisify(execFileCallback);

type CommandResult = { stdout: string; stderr?: string };

export type DisplayServiceDependencies = {
  run(command: string, args: string[]): Promise<CommandResult>;
  spawn(command: string, args: string[]): void;
};

export function parseBrightness(output: string): DisplayStatus {
  const line = output.trim().split("\n").find(Boolean);
  if (!line) return { available: false, brightnessPercent: null };

  const fields = line.split(",");
  const percent = Number.parseInt(fields[fields.length - 1]?.replace("%", "") ?? "", 10);
  return Number.isFinite(percent)
    ? { available: true, brightnessPercent: Math.min(100, Math.max(0, percent)) }
    : { available: false, brightnessPercent: null };
}

export function createDisplayService(dependencies: Partial<DisplayServiceDependencies> = {}) {
  const deps: DisplayServiceDependencies = {
    run: dependencies.run ?? (async (command, args) => execFile(command, args)),
    spawn: dependencies.spawn ?? ((command, args) => {
      const child = spawnProcess(command, args, { detached: true, stdio: "ignore" });
      child.unref();
    }),
  };

  return {
    async getStatus(): Promise<DisplayStatus> {
      try {
        return parseBrightness((await deps.run("brightnessctl", ["--machine-readable", "info"])).stdout);
      } catch {
        return { available: false, brightnessPercent: null };
      }
    },

    async setBrightness(value: unknown): Promise<ApiMessageResponse> {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 5 || value > 100) {
        return { ok: false, message: "El brillo debe estar entre el 5 % y el 100 %." };
      }

      const percent = Math.round(value);
      try {
        await deps.run("brightnessctl", ["--quiet", "set", `${percent}%`]);
        return { ok: true, message: `Brillo ajustado al ${percent} %.` };
      } catch {
        return { ok: false, message: "Este equipo no permite cambiar el brillo desde AgenOS." };
      }
    },

    async turnOff(): Promise<ApiMessageResponse> {
      try {
        deps.spawn("swayidle", [
          "-w", "timeout", "1", "swaymsg 'output * power off'",
          "resume", "swaymsg 'output * power on'; kill $PPID",
        ]);
        return { ok: true, message: "La pantalla se apagará. Mueve el ratón o pulsa una tecla para encenderla." };
      } catch {
        return { ok: false, message: "No se pudo apagar la pantalla." };
      }
    },
  };
}
