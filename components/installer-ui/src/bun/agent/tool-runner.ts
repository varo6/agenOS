import { decidePolicy, type AgentSource, type PolicyDecision } from "./policy";
import { isMemoryNamespace, type createMemoryStore } from "./memory";
import { isLearnedMemoryCandidate, type createLearnedMemoryStore, type LearnedMemoryWriteMetadata } from "./learned-memory";
import { runShellCommand, type ShellExecResult } from "../../../../agent/shell";

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
};

export type ToolRunResult = {
  ok: boolean;
  decision: PolicyDecision;
  correlationId?: string;
  message?: string;
  confirmationId?: string;
  shell?: ShellExecResult;
};

export type ToolRunnerOptions = {
  confirmations?: ConfirmationStoreLike;
  memoryStore?: ReturnType<typeof createMemoryStore>;
  learnedMemory?: ReturnType<typeof createLearnedMemoryStore>;
  shellTool?: typeof runShellCommand;
  correlationIdFactory?: () => string;
};

const SHELL_DENIED_MESSAGE = "La ejecucion shell arbitraria no esta permitida en AgenOS.";

export function createToolRunner(options: ToolRunnerOptions = {}) {
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${Date.now().toString(36)}`);

  return {
    async run(input: ToolRunInput): Promise<ToolRunResult> {
      const correlationId = input.correlationId ?? correlationIdFactory();
      const includeCorrelationId = typeof input.correlationId === "string";
      const policy = decidePolicy({
        tool: input.tool,
        source: input.source,
        input: input.input,
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

      if (input.tool === "memory.write" && input.input && typeof input.input === "object") {
        const response = applyMemoryWrite(options, input.input, {
          source: input.source,
          taskId: input.taskId,
          correlationId,
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

      return {
        ok: true,
        decision: "allow",
        ...(includeCorrelationId ? { correlationId } : {}),
        message: "Tool call accepted.",
      };
    },
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

  return `Ejecutar ${tool}`;
}
