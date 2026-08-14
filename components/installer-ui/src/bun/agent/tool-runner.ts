import { decidePolicy, type AgentSource, type PolicyDecision } from "./policy";
import { isMemoryNamespace, type createMemoryStore } from "./memory";
import { isLearnedMemoryCandidate, type createLearnedMemoryStore, type LearnedMemoryWriteMetadata } from "./learned-memory";
import { runShellCommand, type ShellExecResult } from "../../../../agent/shell";
import type { ConfirmationRecord } from "./confirmations";
import { parsePackageInstallInput } from "./package-installer";

export type ConfirmationRequestInput = {
  source: AgentSource;
  taskId?: string;
  correlationId: string;
  tool: string;
  summary: string;
  input: unknown;
};

export type ConfirmationStoreLike = {
  create(input: ConfirmationRequestInput): { confirmationId: string; status: string };
};

export type ToolRunInput = {
  source: AgentSource;
  taskId?: string;
  correlationId?: string;
  tool: string;
  input: unknown;
  confirmationId?: string;
  explicitUserIntent?: boolean;
  onProgress?: (message: string) => void;
};

export type ToolRunResult = {
  ok: boolean;
  decision: PolicyDecision;
  correlationId?: string;
  message?: string;
  confirmationId?: string;
  shell?: ShellExecResult;
  output?: unknown;
};

export type ToolEffectHandler = (
  input: unknown,
  context: { source: AgentSource; taskId?: string; correlationId: string; onProgress?: (message: string) => void },
) => unknown | Promise<unknown>;

export type ToolRunnerOptions = {
  confirmations?: ConfirmationStoreLike;
  memoryStore?: ReturnType<typeof createMemoryStore>;
  learnedMemory?: ReturnType<typeof createLearnedMemoryStore>;
  shellTool?: typeof runShellCommand;
  correlationIdFactory?: () => string;
  handlers?: Record<string, ToolEffectHandler>;
};

const SHELL_DENIED_MESSAGE = "La ejecucion shell arbitraria no esta permitida en AgenOS.";

export function createToolRunner(options: ToolRunnerOptions = {}) {
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${Date.now().toString(36)}`);

  return {
    async run(input: ToolRunInput): Promise<ToolRunResult> {
      const correlationId = input.correlationId ?? correlationIdFactory();
      const includeCorrelationId = typeof input.correlationId === "string";
      if (input.tool === "packages.install" && !parsePackageInstallInput(input.input)) {
        return {
          ok: false,
          decision: "deny",
          ...(includeCorrelationId ? { correlationId } : {}),
          message: "La instalación requiere un paquete Debian resuelto y validado por el broker.",
        };
      }
      if (!hasExecutor(input.tool)) {
        return unsupportedTool(input.tool, correlationId, includeCorrelationId);
      }
      const policy = decidePolicy({
        tool: input.tool,
        source: input.source,
        input: input.input,
        explicitUserIntent: input.explicitUserIntent,
      });

      if (policy.decision === "deny") {
        return {
          ok: false,
          decision: "deny",
          ...(includeCorrelationId ? { correlationId } : {}),
          message: input.tool === "shell.exec" ? policy.reason || SHELL_DENIED_MESSAGE : policy.reason,
        };
      }

      if (policy.decision === "confirm") {
        const confirmation = options.confirmations?.create({
          source: input.source,
          taskId: input.taskId,
          correlationId,
          tool: input.tool,
          summary: summarizeToolCall(input.tool, input.input),
          input: input.input,
        });

        return {
          ok: false,
          decision: "confirm",
          ...(includeCorrelationId ? { correlationId } : {}),
          confirmationId: confirmation?.confirmationId,
          message: policy.reason,
        };
      }

      return executeAllowed(input, correlationId, includeCorrelationId);
    },
    async executeConfirmed(record: ConfirmationRecord, executionOptions: { onProgress?: (message: string) => void } = {}): Promise<ToolRunResult> {
      if (!hasExecutor(record.tool)) {
        return unsupportedTool(record.tool, record.correlationId, true);
      }
      if (record.tool === "packages.install" && !parsePackageInstallInput(record.input)) {
        return {
          ok: false,
          decision: "deny",
          correlationId: record.correlationId,
          message: "La confirmación no contiene un paquete Debian resuelto y válido; no se instaló nada.",
        };
      }
      const currentPolicy = decidePolicy({
        tool: record.tool,
        source: record.source,
        input: record.input,
      });
      if (currentPolicy.decision === "deny") {
        return {
          ok: false,
          decision: "deny",
          correlationId: record.correlationId,
          message: currentPolicy.reason,
        };
      }
      return executeAllowed({
        source: record.source,
        taskId: record.taskId,
        correlationId: record.correlationId,
        tool: record.tool,
        input: record.input,
        confirmationId: record.confirmationId,
        onProgress: executionOptions.onProgress,
      }, record.correlationId, true);
    },
  };

  async function executeAllowed(input: ToolRunInput, correlationId: string, includeCorrelationId: boolean): Promise<ToolRunResult> {
      if (input.tool === "memory.write" && input.input && typeof input.input === "object") {
        const response = applyMemoryWrite(options, input.input, {
          source: input.source,
          taskId: input.taskId,
          correlationId,
          confirmationId: input.confirmationId,
        });
        if (response) {
          return {
            ok: response.ok,
            decision: "allow",
            ...(includeCorrelationId ? { correlationId } : {}),
            message: response.message,
          };
        }
      }

      if (input.tool === "shell.exec" && input.input && typeof input.input === "object") {
        const commandInput = input.input as { command?: unknown; cwd?: unknown; timeoutMs?: unknown };
        const shell = await (options.shellTool ?? runShellCommand)({
          command: typeof commandInput.command === "string" ? commandInput.command : "",
          cwd: typeof commandInput.cwd === "string" ? commandInput.cwd : undefined,
          timeoutMs: typeof commandInput.timeoutMs === "number" ? commandInput.timeoutMs : undefined,
        });
        return {
          ok: shell.ok,
          decision: "allow",
          ...(includeCorrelationId ? { correlationId } : {}),
          message: shell.message,
          shell,
        };
      }

      const handler = options.handlers?.[input.tool];
      if (handler) {
        const output = await handler(input.input, {
          source: input.source,
          taskId: input.taskId,
          correlationId,
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        });
        const effectOk = !output || typeof output !== "object" || !("ok" in output)
          ? true
          : (output as { ok?: unknown }).ok !== false;
        const effectMessage = output && typeof output === "object" && "message" in output
          && typeof (output as { message?: unknown }).message === "string"
          ? (output as { message: string }).message
          : undefined;
        return {
          ok: effectOk,
          decision: "allow",
          ...(includeCorrelationId ? { correlationId } : {}),
          message: effectMessage,
          output,
        };
      }

      return {
        ok: false,
        decision: "deny",
        ...(includeCorrelationId ? { correlationId } : {}),
        message: `La herramienta ${input.tool} no tiene un ejecutor disponible; no se realizo ninguna accion.`,
      };
  }

  function hasExecutor(tool: string): boolean {
    if (tool === "shell.exec") {
      return true;
    }
    if (tool === "memory.write") {
      return Boolean(options.memoryStore || options.learnedMemory || options.handlers?.[tool]);
    }
    return typeof options.handlers?.[tool] === "function";
  }
}

function unsupportedTool(tool: string, correlationId: string, includeCorrelationId: boolean): ToolRunResult {
  return {
    ok: false,
    decision: "deny",
    ...(includeCorrelationId ? { correlationId } : {}),
    message: `La herramienta ${tool || "desconocida"} no esta disponible en el broker; no se realizo ninguna accion.`,
  };
}

export function applyMemoryWrite(
  stores: Pick<ToolRunnerOptions, "memoryStore" | "learnedMemory">,
  input: unknown,
  metadata: LearnedMemoryWriteMetadata & { taskId?: string },
): { ok: boolean; message: string } | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as { namespace?: unknown; content?: unknown; learned?: unknown };
  if (stores.learnedMemory && isLearnedMemoryCandidate(record.learned)) {
    stores.learnedMemory.add(record.learned, metadata);
    return { ok: true, message: "Memoria aprendida activada." };
  }
  if (stores.memoryStore && isMemoryNamespace(record.namespace)) {
    return stores.memoryStore.append(
      record.namespace,
      typeof record.content === "string" ? record.content : "",
      metadata,
    );
  }
  return null;
}

function summarizeToolCall(tool: string, input: unknown): string {
  if (tool === "shell.exec" && input && typeof input === "object") {
    const command = (input as { command?: unknown }).command;
    return typeof command === "string" && command.trim()
      ? `Ejecutar shell: ${command.trim()}`
      : "Ejecutar shell";
  }

  if (tool === "memory.write" && input && typeof input === "object") {
    const record = input as { namespace?: unknown; content?: unknown };
    const namespace = typeof record.namespace === "string" ? record.namespace : "memory";
    const content = typeof record.content === "string" ? record.content : "";
    return `Guardar en ${namespace}: ${content}`;
  }

  if (tool === "packages.install" && input && typeof input === "object") {
    const record = input as { displayName?: unknown; packageName?: unknown };
    const displayName = typeof record.displayName === "string" && record.displayName.trim()
      ? record.displayName.trim()
      : "la aplicación elegida";
    const packageName = typeof record.packageName === "string" ? record.packageName : "paquete desconocido";
    return `Voy a instalar ${displayName} (${packageName}), ¿sigo?`;
  }

  return `Ejecutar ${tool}`;
}
