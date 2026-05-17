import { homedir } from "node:os";
import { join } from "node:path";
import { createConfirmationStore, type ConfirmationStoreOptions } from "./confirmations";
import { createDiagnosticsBundle } from "./diagnostics";
import { createMemoryStore } from "./memory";
import { createTaskQueue } from "./tasks";
import { decidePolicy } from "./policy";
import { POLICY_RULES } from "./policy-rules";
import { readWorkerConfig, redactWorkerConfig, type RedactedWorkerConfig, type WorkerConfig } from "./worker/config";
import type { WorkerAdapter, WorkerHealth } from "./worker/types";

export type AgentAdminReadiness = "ready" | "degraded" | "needs_setup";
export type AgentAdminActor = "ui" | "system";

export type AgentAdminSetupItem = {
  id: string;
  label: string;
  severity: "info" | "warning" | "error";
  action: "configure_provider" | "test_connection" | "switch_mode" | "view_logs";
};

export type AgentAdminServiceOptions = {
  stateDir?: string;
  env?: Record<string, string | undefined>;
  config?: WorkerConfig;
  worker?: Pick<WorkerAdapter, "health" | "events" | "list">;
  memoryStore?: ReturnType<typeof createMemoryStore>;
  taskQueue?: ReturnType<typeof createTaskQueue>;
  confirmations?: ReturnType<typeof createConfirmationStore> | { create(input: unknown): { confirmationId: string; status: string } };
  confirmationOptions?: ConfirmationStoreOptions;
};

export function createAgentAdminService(options: AgentAdminServiceOptions = {}) {
  const env = options.env ?? process.env;
  const baseConfig = options.config ?? readWorkerConfig({ env });
  const config: WorkerConfig = {
    ...baseConfig,
    stateDir: options.stateDir ?? baseConfig.stateDir,
  };
  const worker = options.worker ?? options.taskQueue ?? createTaskQueue();
  const memoryStore = options.memoryStore ?? createMemoryStore({ rootDir: join(expandHome(config.stateDir), "memory") });
  const taskQueue = options.taskQueue ?? createTaskQueue({ rootDir: expandHome(config.stateDir) });
  const confirmations = options.confirmations ?? createConfirmationStore(options.confirmationOptions);

  async function status() {
    const workerHealth = normalizeHealth(await worker.health(), config.stateDir);
    const redactedConfig = redactWorkerConfig(config, env);
    const setupItems = setupItemsFor(workerHealth, redactedConfig);
    const readiness = readinessFor(workerHealth, setupItems);

    return {
      ok: workerHealth.ok && readiness !== "needs_setup",
      readiness,
      setupItems,
      worker: {
        mode: workerHealth.mode,
        serviceActive: workerHealth.serviceActive,
        version: workerHealth.version,
        queueDepth: workerHealth.queueDepth,
        degradedReason: workerHealth.degradedReason,
        lastHeartbeatAt: workerHealth.lastHeartbeatAt,
        lastError: workerHealth.lastError,
        lastErrorCorrelationId: workerHealth.lastErrorCorrelationId,
      },
      config: redactedConfig,
    };
  }

  return {
    status,
    async readConfig() {
      return redactWorkerConfig(config, env);
    },
    readPolicy() {
      return {
        defaults: config.policyDefaults,
        rules: POLICY_RULES.map(({ ruleId, tool, source, decision, reason }) => ({
          ruleId,
          tool,
          source,
          decision,
          reason,
        })),
      };
    },
    async writeConfig(patch: Partial<WorkerConfig>, actor: AgentAdminActor) {
      return confirmationRequired({
        actor,
        tool: "admin.config.write",
        summary: "Cambiar configuracion del backend",
        input: patch,
      });
    },
    async restart(actor: AgentAdminActor) {
      return confirmationRequired({
        actor,
        tool: "admin.service.restart",
        summary: "Reiniciar servicio del backend",
        input: {},
      });
    },
    async testConnection(_actor: AgentAdminActor) {
      const current = await status();
      return {
        ok: current.readiness === "ready",
        status: current.readiness === "ready" ? 200 : 503,
        readiness: current.readiness,
        message: current.readiness === "ready" ? "Connection ready." : "Provider/auth is not configured.",
        setupItems: current.setupItems,
      };
    },
    async retryTask(taskId: string, _actor: AgentAdminActor) {
      return { ok: true, taskId, message: "Task retry requested." };
    },
    async clearTask(taskId: string, actor: AgentAdminActor) {
      return confirmationRequired({
        actor,
        tool: "admin.queue.clear",
        summary: `Limpiar tarea ${taskId}`,
        input: { taskId },
      });
    },
    async exportDiagnostics(_actor: AgentAdminActor) {
      const workerHealth = normalizeHealth(await worker.health(), config.stateDir);
      return createDiagnosticsBundle({
        workerHealth,
        config: redactWorkerConfig(config, env),
        taskEvents: await recentTaskEvents(taskQueue),
        memoryEvents: memoryStore.events?.(25) ?? [],
        brokerErrors: workerHealth.lastError ? [{ correlationId: workerHealth.lastErrorCorrelationId, message: workerHealth.lastError }] : [],
        policyRules: this.readPolicy().rules,
      });
    },
  };

  function confirmationRequired(input: { actor: AgentAdminActor; tool: string; summary: string; input: unknown }) {
    const policy = decidePolicy({ tool: input.tool, source: input.actor });
    if (policy.decision !== "confirm") {
      return { ok: true, decision: policy.decision, message: policy.reason };
    }

    const confirmation = confirmations.create({
      source: input.actor,
      correlationId: `corr_${Date.now().toString(36)}`,
      tool: input.tool,
      summary: input.summary,
      input: input.input,
    } as never);

    return {
      ok: false,
      decision: "confirm",
      ruleId: policy.ruleId,
      confirmationId: confirmation.confirmationId,
      message: policy.reason,
    };
  }
}

async function recentTaskEvents(taskQueue: ReturnType<typeof createTaskQueue>): Promise<Array<Record<string, unknown>>> {
  const tasks = await taskQueue.list(10);
  const eventSets = await Promise.all(tasks.map((task) => taskQueue.events(task.taskId)));
  return eventSets.flat().slice(-25);
}

function normalizeHealth(health: Partial<WorkerHealth>, fallbackStateDir: string): WorkerHealth {
  return {
    schemaVersion: 1,
    ok: health.ok ?? false,
    mode: health.mode ?? "local-simulated",
    serviceActive: health.serviceActive ?? false,
    version: health.version ?? "unknown",
    stateDir: health.stateDir ?? fallbackStateDir,
    queueDepth: health.queueDepth ?? 0,
    degradedReason: health.degradedReason ?? null,
    lastHeartbeatAt: health.lastHeartbeatAt ?? null,
    lastHeartbeatCorrelationId: health.lastHeartbeatCorrelationId ?? null,
    lastError: health.lastError ?? null,
    lastErrorCorrelationId: health.lastErrorCorrelationId ?? null,
    counters: health.counters ?? { accepted: 0, confirmed: 0, denied: 0, failed: 0, retried: 0 },
  };
}

function readinessFor(health: WorkerHealth, setupItems: AgentAdminSetupItem[]): AgentAdminReadiness {
  if (setupItems.some((item) => item.action === "configure_provider")) {
    return "needs_setup";
  }
  if (!health.ok || health.degradedReason || health.lastError) {
    return "degraded";
  }
  return "ready";
}

function setupItemsFor(health: WorkerHealth, config: RedactedWorkerConfig): AgentAdminSetupItem[] {
  const items: AgentAdminSetupItem[] = [];
  if (config.provider === "none" || config.model === "none" || !config.apiAuth.configured) {
    items.push({
      id: "provider-auth",
      label: "Configure provider and API credentials.",
      severity: "warning",
      action: "configure_provider",
    });
  }
  if (!health.ok || health.lastError || health.degradedReason) {
    items.push({
      id: "worker-health",
      label: "Review worker status and logs.",
      severity: health.ok ? "warning" : "error",
      action: "view_logs",
    });
  }
  return items;
}

function expandHome(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}
