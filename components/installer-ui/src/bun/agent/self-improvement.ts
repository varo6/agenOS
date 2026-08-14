import type { HarnessTraceRecord } from "../../../../agent/harness-trace";
import type { ConfirmationRecord } from "./confirmations";
import type {
  LearnedMemoryCandidate,
  LearningSignal,
  LearningSignalInput,
  createLearnedMemoryStore,
} from "./learned-memory";
import type { WorkerTask } from "./worker";

type LearnedStore = ReturnType<typeof createLearnedMemoryStore>;

export type SelfImprovementLoopOptions = {
  memory: LearnedStore;
  listConfirmations?: (limit?: number) => ConfirmationRecord[];
  proposeMemoryWrite: (input: {
    namespace: LearnedMemoryCandidate["namespace"];
    content: string;
    learned: LearnedMemoryCandidate;
  }) => Promise<unknown>;
};

export type CaptureResult = {
  signals: LearningSignal[];
  proposals: LearnedMemoryCandidate[];
};

function stableId(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(":").replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function looksLikeCorrection(input: string): boolean {
  return /(^|\b)(no[,;:]?|as[ií] no|prefiero|quiero que|a partir de ahora|recuerda que|siempre|nunca)\b/i.test(input);
}

export function createSelfImprovementLoop(options: SelfImprovementLoopOptions) {
  async function recordAndMaybePropose(input: LearningSignalInput): Promise<CaptureResult> {
    const signal = options.memory.recordSignal(input);
    const candidate = options.memory.distill(signal);
    if (!candidate || isKnown(candidate)) {
      return { signals: [signal], proposals: [] };
    }
    await options.proposeMemoryWrite({
      namespace: candidate.namespace,
      content: candidate.statement,
      learned: candidate,
    });
    return { signals: [signal], proposals: [candidate] };
  }

  function isKnown(candidate: LearnedMemoryCandidate): boolean {
    const normalized = candidate.statement.trim().toLowerCase();
    if (options.memory.list().some((item) => item.statement.trim().toLowerCase() === normalized)) {
      return true;
    }
    return (options.listConfirmations?.(100) ?? []).some((record) => {
      if (record.status !== "pending" || record.tool !== "memory.write" || !record.input || typeof record.input !== "object") {
        return false;
      }
      const learned = (record.input as { learned?: { statement?: unknown } }).learned;
      return typeof learned?.statement === "string" && learned.statement.trim().toLowerCase() === normalized;
    });
  }

  return {
    memory: options.memory,
    async captureHarnessTrace(trace: HarnessTraceRecord): Promise<CaptureResult> {
      const results: CaptureResult[] = [];
      results.push(await recordAndMaybePropose({
        signalId: stableId("sig", trace.traceId, trace.status),
        type: trace.status === "succeeded" ? "turn_succeeded" : "turn_failed",
        source: "foreground",
        traceId: trace.traceId,
        summary: trace.status === "succeeded"
          ? `Turno completado; herramientas correctas: ${trace.toolEvents.filter((event) => event.ok).map((event) => event.toolName).join(", ") || "ninguna"}.`
          : trace.error ?? "El turno foreground fallo sin detalle.",
      }));

      if (looksLikeCorrection(trace.input.text)) {
        results.push(await recordAndMaybePropose({
          signalId: stableId("sig", trace.traceId, "correction"),
          type: "explicit_correction",
          source: "foreground",
          traceId: trace.traceId,
          summary: "El usuario expreso una correccion o preferencia durable.",
          inputPreview: trace.input.text,
        }));
      }

      for (const [index, event] of trace.toolEvents.entries()) {
        results.push(await recordAndMaybePropose({
          signalId: stableId("sig", trace.traceId, "tool", String(index), event.toolName, event.ok ? "ok" : "failed"),
          type: event.ok ? "tool_succeeded" : "tool_failed",
          source: "foreground",
          traceId: trace.traceId,
          tool: event.toolName,
          summary: event.ok ? `La herramienta ${event.toolName} termino correctamente.` : event.output?.text ?? `La herramienta ${event.toolName} fallo.`,
        }));
      }

      return combine(results);
    },
    captureTask(task: WorkerTask): Promise<CaptureResult> {
      if (task.status !== "failed") {
        return Promise.resolve({ signals: [], proposals: [] });
      }
      return recordAndMaybePropose({
        signalId: stableId("sig", task.taskId, "failed"),
        type: "task_failed",
        source: "worker",
        taskId: task.taskId,
        correlationId: task.correlationId,
        summary: task.lastError ?? "La tarea de background fallo sin detalle.",
      });
    },
    captureRetry(taskId: string, correlationId?: string): Promise<CaptureResult> {
      return recordAndMaybePropose({
        signalId: stableId("sig", taskId, "retry"),
        type: "task_retried",
        source: "worker",
        taskId,
        correlationId,
        summary: `El usuario solicito reintentar la tarea ${taskId}.`,
      });
    },
    captureDenied(record: ConfirmationRecord): Promise<CaptureResult> {
      return recordAndMaybePropose({
        signalId: stableId("sig", record.confirmationId, "denied"),
        type: "confirmation_denied",
        source: "confirmation",
        correlationId: record.correlationId,
        confirmationId: record.confirmationId,
        taskId: record.taskId,
        tool: record.tool,
        summary: record.summary,
      });
    },
  };
}

function combine(results: CaptureResult[]): CaptureResult {
  return {
    signals: results.flatMap((result) => result.signals),
    proposals: results.flatMap((result) => result.proposals),
  };
}
