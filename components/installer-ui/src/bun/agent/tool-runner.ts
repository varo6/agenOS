import { decidePolicy, type AgentSource, type PolicyDecision } from "./policy";

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
};

export type ToolRunnerOptions = {
  confirmations?: ConfirmationStoreLike;
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
      });

      if (policy.decision === "deny") {
        return {
          ok: false,
          decision: "deny",
          ...(includeCorrelationId ? { correlationId } : {}),
          message: input.tool === "shell.exec" ? SHELL_DENIED_MESSAGE : policy.reason,
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

      return {
        ok: true,
        decision: "allow",
        ...(includeCorrelationId ? { correlationId } : {}),
        message: "Tool call accepted.",
      };
    },
  };
}

function summarizeToolCall(tool: string, input: unknown): string {
  if (tool === "memory.write" && input && typeof input === "object") {
    const record = input as { namespace?: unknown; content?: unknown };
    const namespace = typeof record.namespace === "string" ? record.namespace : "memory";
    const content = typeof record.content === "string" ? record.content : "";
    return `Guardar en ${namespace}: ${content}`;
  }

  return `Ejecutar ${tool}`;
}
