import { homedir } from "node:os";
import { AGENT_PROTOCOL_SCHEMA_VERSION } from "./protocol";
import { createObservabilityState } from "./observability";
import { createWorkerTaskStore } from "./task-store";
import { createOpenClawRuntime, type OpenClawRuntime } from "./openclaw-runtime";
import type { WorkerAdapter, WorkerProgressEvent, WorkerTask, WorkerTaskStatus } from "./types";

const TERMINAL_STATUSES = new Set<WorkerTaskStatus>(["succeeded", "failed", "cancelled"]);

export type OpenClawProcessAdapterOptions = {
  binaryPath?: string;
  stateDir: string;
  now?: () => Date;
  runtime?: OpenClawRuntime;
  idFactory?: () => string;
  correlationIdFactory?: () => string;
  learnedContextProvider?: (query: string) => Promise<string> | string;
};

export function createOpenClawProcessAdapter(options: OpenClawProcessAdapterOptions): WorkerAdapter & { superviseGateway: () => { stop: () => void } } {
  const stateDir = expandHomeDir(options.stateDir);
  const now = options.now ?? (() => new Date());
  const runtime = options.runtime ?? createOpenClawRuntime({ stateDir, binaryPath: options.binaryPath });
  const idFactory = options.idFactory ?? (() => `task_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const correlationIdFactory = options.correlationIdFactory ?? (() => `corr_${now().getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const observability = createObservabilityState({ now });
  const store = createWorkerTaskStore(stateDir);
  let cachedVersion: string | null = null;

  async function resolveVersion(): Promise<string | null> {
    if (!cachedVersion) {
      cachedVersion = await runtime.version();
    }
    return cachedVersion;
  }

  function appendTaskEvent(task: WorkerTask, type: WorkerProgressEvent["type"], message: string, status: WorkerTaskStatus, progress: number, lastError: string | null = null): void {
    const timestamp = now().toISOString();
    store.appendTask({ ...task, timestamp, status, progress, lastError });
    store.appendEvent({
      schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
      taskId: task.taskId,
      correlationId: task.correlationId,
      timestamp,
      type,
      message,
      progress,
    });
  }

  async function runTask(task: WorkerTask): Promise<void> {
    appendTaskEvent(task, "started", "OpenClaw esta procesando la tarea.", "running", 10);
    const learnedContext = await options.learnedContextProvider?.(task.message) ?? "";
    const result = await runtime.chat(task.message, { systemContext: learnedContext });
    if (result.ok) {
      appendTaskEvent(task, "completed", result.content ?? "Tarea completada.", "succeeded", 100);
      observability.increment("confirmed");
    } else {
      const reason = result.message ?? "OpenClaw fallo sin detalle.";
      appendTaskEvent(task, "failed", reason, "failed", 100, reason);
      observability.increment("failed");
      observability.setDegraded(reason, task.correlationId);
    }
  }

  const adapter: WorkerAdapter & { superviseGateway: () => { stop: () => void } } = {
    async health() {
      const correlationId = correlationIdFactory();
      const binary = runtime.resolveBinary();
      let ok = false;
      if (!binary) {
        observability.setDegraded(`OpenClaw binary not found: ${options.binaryPath ?? "/usr/bin/openclaw"}`, correlationId);
      } else {
        const probe = await runtime.probeGateway();
        if (probe.ok) {
          ok = true;
          observability.clearDegraded();
        } else {
          observability.setDegraded(probe.message ?? "OpenClaw gateway no disponible.", correlationId);
        }
      }
      observability.recordHeartbeat(correlationId);

      return {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        ok,
        mode: "openclaw-process" as const,
        serviceActive: ok,
        version: (binary ? await resolveVersion() : null) ?? "unavailable",
        stateDir,
        queueDepth: store.queueDepth(),
        ...observability.snapshot(),
      };
    },
    async testConnection() {
      if (!runtime.resolveBinary()) {
        return { ok: false, message: "OpenClaw no esta instalado; ejecuta el setup del backend." };
      }
      const result = await runtime.chat("Responde unicamente con OK para verificar la conexion del proveedor.", { timeoutMs: 15_000 });
      return result.ok
        ? { ok: true, message: "Conexion real con el proveedor verificada mediante OpenClaw." }
        : { ok: false, message: result.message ?? "El proveedor no completo la prueba de conexion." };
    },
    async enqueue(input) {
      const message = input.message.trim();
      if (!message) {
        return { ok: false, message: "La tarea no puede estar vacia." };
      }
      if (!runtime.resolveBinary()) {
        return { ok: false, message: "OpenClaw no esta instalado; ejecuta el setup del backend." };
      }
      const probe = await runtime.probeGateway();
      if (!probe.ok) {
        return { ok: false, message: probe.message ?? "El gateway de OpenClaw no esta disponible." };
      }

      const taskId = idFactory();
      const correlationId = input.correlationId ?? correlationIdFactory();
      const task: WorkerTask = {
        schemaVersion: AGENT_PROTOCOL_SCHEMA_VERSION,
        taskId,
        correlationId,
        timestamp: now().toISOString(),
        source: input.source,
        message,
        status: "queued",
        progress: 0,
        lastError: null,
      };
      appendTaskEvent(task, "queued", "Tarea encolada en OpenClaw.", "queued", 0);
      observability.increment("accepted");
      void runTask(task).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        appendTaskEvent(task, "failed", reason, "failed", 100, reason);
        observability.increment("failed");
      });

      return { ok: true, taskId, correlationId, message: "Tarea enviada a OpenClaw." };
    },
    async status(taskId) {
      return store.getTask(taskId);
    },
    async events(taskId) {
      return store.getEvents(taskId);
    },
    async list(limit) {
      return store.list(limit);
    },
    async retry(taskId) {
      const task = store.getTask(taskId);
      if (!task) {
        return { ok: false, taskId, message: `No existe la tarea ${taskId}.` };
      }
      if (!TERMINAL_STATUSES.has(task.status)) {
        return { ok: false, taskId, message: `La tarea ${taskId} sigue activa y no se puede reintentar.` };
      }
      return adapter.enqueue({ message: task.message, source: task.source });
    },
    async clear(taskId) {
      const task = store.getTask(taskId);
      if (!task) {
        return { ok: false, taskId, message: `No existe la tarea ${taskId}.` };
      }
      if (!TERMINAL_STATUSES.has(task.status)) {
        return { ok: false, taskId, message: `La tarea ${taskId} sigue activa y no se puede limpiar.` };
      }
      const cleared = store.clearTask(taskId);
      return {
        ok: cleared,
        taskId,
        message: cleared ? `Tarea ${taskId} eliminada.` : `No existe la tarea ${taskId}.`,
      };
    },
    async resolveConfirmation(taskId) {
      return { ok: false, taskId, message: `OpenClaw no tiene una continuacion pendiente para la tarea ${taskId}.` };
    },
    superviseGateway() {
      return runtime.startGateway();
    },
  };

  return adapter;
}

function expandHomeDir(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}
