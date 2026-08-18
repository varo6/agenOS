import type { ComputerRunOutcome } from "../../../../agent/computer-run-tool";
import type { ShellExecResult } from "../../../../agent/shell";
import type { createConfirmationStore } from "./confirmations";
import type { AgentSource } from "./policy";
import type { createToolRunner } from "./tool-runner";

export type ComputerRunServiceOptions = {
  toolRunner: ReturnType<typeof createToolRunner>;
  confirmations: ReturnType<typeof createConfirmationStore>;
};

export type ComputerRunInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
};

function baseOutcome(command: string): ComputerRunOutcome {
  return {
    status: "failed",
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    command,
    message: "",
  };
}

function fromShell(command: string, shell: ShellExecResult): ComputerRunOutcome {
  return {
    status: "completed",
    ok: shell.ok,
    exitCode: shell.exitCode,
    stdout: shell.stdout,
    stderr: shell.stderr,
    timedOut: shell.timedOut,
    command: shell.command || command,
    message: shell.message,
  };
}

function confirmationQuestion(command: string): string {
  return `Voy a ejecutar «${command}». Es una operación que puede cambiar o borrar cosas del ordenador y no siempre se puede deshacer. ¿Sigo?`;
}

export function createComputerRunService(options: ComputerRunServiceOptions) {
  function commandOf(input: unknown): string {
    return input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string"
      ? (input as { command: string }).command
      : "";
  }

  return {
    async request(input: ComputerRunInput, source: AgentSource = "ui"): Promise<ComputerRunOutcome> {
      const command = String(input.command ?? "").trim();
      if (!command) {
        return { ...baseOutcome(""), message: "El comando es obligatorio." };
      }

      const result = await options.toolRunner.run({
        source,
        tool: "shell.exec",
        input: { command, cwd: input.cwd, timeoutMs: input.timeoutMs },
        // La shell solo se permite cuando la pide la sesión del usuario; el
        // broker lo exige y sin esta marca la política la deniega.
        explicitUserIntent: true,
      });

      if (result.decision === "confirm") {
        return {
          ...baseOutcome(command),
          status: "confirmation_required",
          ...(result.confirmationId ? { confirmationId: result.confirmationId } : {}),
          message: confirmationQuestion(command),
        };
      }

      if (result.decision === "deny") {
        return {
          ...baseOutcome(command),
          status: "denied",
          message: result.message ?? "El broker no permitió ejecutar ese comando; no se hizo nada.",
        };
      }

      if (!result.shell) {
        return {
          ...baseOutcome(command),
          message: result.message ?? "El broker no devolvió un resultado verificable del comando; no doy por hecho que se ejecutara.",
        };
      }

      return fromShell(command, result.shell);
    },

    async confirm(confirmationId: string, onProgress?: (message: string) => void): Promise<ComputerRunOutcome> {
      const pending = options.confirmations.get(confirmationId);
      if (!pending || pending.tool !== "shell.exec") {
        return { ...baseOutcome(""), message: "No encuentro un comando pendiente con ese identificador." };
      }
      const command = commandOf(pending.input);
      if (pending.status !== "pending") {
        return {
          ...baseOutcome(command),
          message: `Ese comando ya fue ${pending.status === "confirmed" ? "confirmado" : "cancelado"}; no lo he repetido.`,
        };
      }

      const confirmed = options.confirmations.confirm(confirmationId, "ui");
      if (!confirmed) {
        return { ...baseOutcome(command), message: "No pude registrar la confirmación; no se ejecutó nada." };
      }

      const execution = await options.toolRunner.executeConfirmed(confirmed, {
        ...(onProgress ? { onProgress } : {}),
      });
      if (execution.decision === "deny") {
        return {
          ...baseOutcome(command),
          status: "denied",
          message: execution.message ?? "La política del broker rechazó el comando al ejecutarlo.",
        };
      }
      if (!execution.shell) {
        return {
          ...baseOutcome(command),
          message: execution.message ?? "El broker no devolvió la salida del comando confirmado.",
        };
      }
      return fromShell(command, execution.shell);
    },

    deny(confirmationId: string): ComputerRunOutcome {
      const pending = options.confirmations.get(confirmationId);
      if (!pending || pending.tool !== "shell.exec" || pending.status !== "pending") {
        return { ...baseOutcome(""), message: "No encuentro un comando pendiente que pueda cancelar." };
      }
      options.confirmations.deny(confirmationId, "ui");
      return {
        ...baseOutcome(commandOf(pending.input)),
        status: "cancelled",
        ok: true,
        message: "Comando cancelado; no se ejecutó nada.",
      };
    },
  };
}
