import type { MaintenanceAction } from "../../shared/installer-types";

export const SYSTEM_VOICE_DEMO_TRANSCRIPT = "abre terminal de mantenimiento";

export type SystemCommandIntent = "open_maintenance_terminal";

export type InterpretedSystemCommand =
  | {
      ok: true;
      intent: SystemCommandIntent;
      action: MaintenanceAction;
      summary: string;
    }
  | {
      ok: false;
      message: string;
    };

const TERMINAL_COMMANDS = new Set([
  "terminal",
  "abre terminal",
  "abrir terminal",
  "abre la terminal",
  "abrir la terminal",
  "terminal de mantenimiento",
  "abre terminal de mantenimiento",
  "abrir terminal de mantenimiento",
]);

export function normalizeSystemCommand(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function interpretSystemCommand(input: string): InterpretedSystemCommand {
  const normalized = normalizeSystemCommand(input);
  if (TERMINAL_COMMANDS.has(normalized)) {
    return {
      ok: true,
      intent: "open_maintenance_terminal",
      action: "terminal",
      summary: "Abrir terminal de mantenimiento",
    };
  }

  return {
    ok: false,
    message: "No he entendido el comando. Prueba con 'abre terminal de mantenimiento'.",
  };
}
