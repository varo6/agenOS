import type { ShellExecResult } from "./shell";

export type ComputerRunner = (input: { command: string; cwd?: string; timeoutMs?: number }) => Promise<ShellExecResult>;

type ToolUpdateCallback = (update: {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}) => void;

type PiCustomToolLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

export type ComputerRunToolDetails = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
  message: string;
};

export type ComputerRunStatus = "completed" | "confirmation_required" | "denied" | "cancelled" | "failed";

export type ComputerRunOutcome = ComputerRunToolDetails & {
  status: ComputerRunStatus;
  confirmationId?: string;
};

// La shell pasa por la politica del broker: los comandos destructivos vuelven
// como "confirmation_required" y solo se ejecutan cuando el usuario dice que si
// en un turno posterior, igual que las instalaciones de paquetes.
export type ComputerRunService = {
  request(input: { command: string; cwd?: string; timeoutMs?: number }): Promise<ComputerRunOutcome>;
  confirm(confirmationId: string, onProgress?: (message: string) => void): Promise<ComputerRunOutcome>;
  deny(confirmationId: string): ComputerRunOutcome | Promise<ComputerRunOutcome>;
};

const MAX_TEXT_CHARS = 4000;
const TRUNCATION_SUFFIX = "\n[salida truncada]";

const COMPUTER_RUN_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "Comando de shell a ejecutar en el ordenador del usuario, por ejemplo 'ls ~/Documentos' o 'systemctl status bluetooth'.",
    },
    cwd: {
      type: "string",
      description: "Directorio de trabajo desde el que ejecutar el comando. Por defecto la carpeta del usuario.",
    },
    timeoutMs: {
      type: "number",
      description: "Milisegundos máximos de espera antes de cancelar el comando. Por defecto 30000.",
    },
    action: {
      type: "string",
      enum: ["run", "confirm", "deny"],
      description: "run pide ejecutar el comando; confirm ejecuta una petición que el broker dejó pendiente tras el sí del usuario; deny la cancela.",
    },
    confirmationId: {
      type: "string",
      description: "Identificador devuelto por el broker cuando el comando necesita confirmación. Obligatorio en confirm y deny.",
    },
  },
  required: [],
  additionalProperties: false,
};

export function createComputerRunModelTool(service: ComputerRunService): PiCustomToolLike {
  return {
    name: "computer_run",
    label: "Ejecutar en el ordenador",
    description: "Ejecuta comandos de shell reales en el ordenador del usuario y devuelve su salida.",
    promptSnippet: "computer_run: shell real del ordenador del usuario; ejecuta cualquier comando que harías tú en un terminal y lee su salida.",
    promptGuidelines: [
      "computer_run es una shell real sobre el ordenador del usuario: úsala para cualquier cosa que una persona haría en un terminal.",
      "Sirve para leer y escribir ficheros, gestionar procesos, configurar el sistema y consultar hardware, red, discos o servicios.",
      "Prefiere comandos no interactivos: añade flags como -y, --no-pager o --noconfirm y evita editores o prompts que se queden esperando.",
      "Nunca afirmes que ejecutaste algo ni inventes salidas: si no has llamado a computer_run, no lo has hecho.",
      "Encadena varias llamadas a computer_run para tareas de varios pasos: comprueba el estado, actúa y vuelve a comprobar el resultado.",
      "Si un comando falla, lee el código de salida y stderr, corrige el comando y reintenta en vez de rendirte.",
      "Si el broker responde que hace falta confirmación, traslada al usuario la pregunta exacta que te devuelve el tool junto con el comando, y no confirmes nunca en el mismo turno que creó la petición.",
      "Cuando el usuario diga que sí en un turno posterior, llama con action \"confirm\" y el confirmationId; si dice que no, llama con action \"deny\".",
    ],
    parameters: COMPUTER_RUN_TOOL_PARAMETERS,
    async execute(_toolCallId, params, _signal, onUpdate) {
      const action = typeof params.action === "string" && params.action.trim() ? params.action.trim() : "run";
      const confirmationId = typeof params.confirmationId === "string" ? params.confirmationId.trim() : "";

      if (action === "confirm" || action === "deny") {
        if (!confirmationId) {
          return failure("", `Necesito el confirmationId para ${action === "confirm" ? "confirmar" : "cancelar"} el comando pendiente.`);
        }
        try {
          const outcome = action === "confirm"
            ? await service.confirm(confirmationId, (message) => onUpdate?.({
              content: [{ type: "text", text: message }],
              details: { ok: true, message },
            }))
            : await service.deny(confirmationId);
          return present(outcome);
        } catch (error) {
          return failure("", `No pude ${action === "confirm" ? "confirmar" : "cancelar"} el comando: ${errorMessage(error)}`);
        }
      }

      const command = typeof params.command === "string" ? params.command.trim() : "";
      if (!command) {
        return failure("", "El comando es obligatorio: indica qué quieres ejecutar en el ordenador.");
      }

      let outcome: ComputerRunOutcome;
      try {
        outcome = await service.request({
          command,
          cwd: typeof params.cwd === "string" && params.cwd.trim() ? params.cwd.trim() : undefined,
          timeoutMs: typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) ? params.timeoutMs : undefined,
        });
      } catch (error) {
        return failure(command, `No pude ejecutar el comando: ${errorMessage(error)}`);
      }

      return present(outcome);
    },
  };
}

function present(outcome: ComputerRunOutcome): { content: Array<{ type: "text"; text: string }>; details: ComputerRunOutcome } {
  const text = outcome.status === "completed"
    ? renderResult(outcome)
    : outcome.message;
  return {
    content: [{ type: "text", text: truncate(text) }],
    details: outcome,
  };
}

function renderResult(details: ComputerRunToolDetails): string {
  const stdout = truncate(details.stdout.trim());
  const stderr = truncate(details.stderr.trim());
  const lines: string[] = [`$ ${details.command}`];

  if (details.ok) {
    lines.push(stdout ? `Salida:\n${stdout}` : "Comando completado sin salida.");
    if (stderr) {
      lines.push(`Avisos (stderr):\n${stderr}`);
    }
    return lines.join("\n");
  }

  lines.push(details.timedOut
    ? `El comando se canceló por timeout. ${details.message}`
    : `El comando falló con código de salida ${details.exitCode ?? "desconocido"}.`);
  lines.push(stderr ? `Error (stderr):\n${stderr}` : "stderr vacío.");
  if (stdout) {
    lines.push(`Salida (stdout):\n${stdout}`);
  }
  lines.push("Corrige el comando a partir de este error y vuelve a intentarlo si tiene sentido.");
  return lines.join("\n");
}

function failure(command: string, message: string): { content: Array<{ type: "text"; text: string }>; details: ComputerRunOutcome } {
  const details: ComputerRunOutcome = {
    status: "failed",
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    command,
    message,
  };
  return { content: [{ type: "text", text: message }], details };
}

function truncate(value: string): string {
  return value.length > MAX_TEXT_CHARS ? `${value.slice(0, MAX_TEXT_CHARS)}${TRUNCATION_SUFFIX}` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
