import { homedir } from "node:os";
import { join } from "node:path";
import { createConfirmationStore, type ConfirmationStoreOptions } from "./confirmations";
import { createDiagnosticsBundle } from "./diagnostics";
import { createMemoryStore } from "./memory";
import { createOpenClawSetupService, type OpenClawSetupState } from "./setup";
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
  action:
    | "configure_provider"
    | "test_connection"
    | "switch_mode"
    | "view_logs"
    | "connect_backend_codex"
    | "configure_telegram"
    | "test_telegram"
    | "enable_telegram"
    | "rerun_setup";
};

export type AgentAdminServiceOptions = {
  stateDir?: string;
  env?: Record<string, string | undefined>;
  config?: WorkerConfig;
  worker?: Pick<WorkerAdapter, "health" | "events" | "list">;
  setup?: Pick<ReturnType<typeof createOpenClawSetupService>, "status">;
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
  const setup = options.setup ?? createOpenClawSetupService({ stateDir: config.stateDir, env });
  const memoryStore = options.memoryStore ?? createMemoryStore({ rootDir: join(expandHome(config.stateDir), "memory") });
  const taskQueue = options.taskQueue ?? createTaskQueue({ rootDir: expandHome(config.stateDir) });
  const confirmations = options.confirmations ?? createConfirmationStore(options.confirmationOptions);

  async function status() {
    const workerHealth = normalizeHealth(await worker.health(), config.stateDir);
    const setupState = normalizeSetup(await setup.status());
    const redactedConfig = redactWorkerConfig(config, env);
    const setupItems = [...setupItemsFor(workerHealth, redactedConfig), ...setupItemsForOpenClaw(setupState)];
    const readiness = readinessFor(workerHealth, setupItems);

    return {
      ok: workerHealth.ok && readiness !== "needs_setup",
      readiness,
      setupItems,
      setup: {
        phase: setupState.phase,
        message: setupState.message,
        actions: setupState.actions,
        codex: setupState.codex,
        telegram: setupState.telegram,
      },
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

function normalizeSetup(setup: Partial<OpenClawSetupState>): OpenClawSetupState {
  return {
    schemaVersion: 1,
    ok: setup.ok ?? false,
    phase: setup.phase ?? "degraded",
    message: setup.message ?? "OpenClaw setup state is unavailable.",
    workerMode: setup.workerMode ?? "simulated",
    openclaw: setup.openclaw ?? {
      installed: false,
      healthy: false,
      binaryPath: "/usr/bin/openclaw",
      version: null,
      gatewayUrl: null,
      lastError: null,
    },
    codex: setup.codex ?? {
      configured: false,
      profile: null,
      loginAvailable: false,
      lastError: null,
    },
    telegram: setup.telegram ?? {
      enabled: false,
      tokenConfigured: false,
      botUsername: null,
      lastTestOk: null,
      lastError: null,
    },
    actions: setup.actions ?? [],
    updatedAt: setup.updatedAt ?? new Date(0).toISOString(),
    correlationId: setup.correlationId ?? "corr_unavailable",
  };
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
  if (setupItems.some((item) => (
    item.action === "configure_provider"
    || item.action === "connect_backend_codex"
    || item.action === "configure_telegram"
    || item.action === "test_telegram"
    || item.action === "enable_telegram"
    || item.action === "rerun_setup"
  ))) {
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

function setupItemsForOpenClaw(setup: OpenClawSetupState): AgentAdminSetupItem[] {
  const items: AgentAdminSetupItem[] = [];
  if (setup.actions.includes("codex.login")) {
    items.push({
      id: "backend-codex-auth",
      label: "Connect backend Codex auth for OpenClaw.",
      severity: "warning",
      action: "connect_backend_codex",
    });
  }
  if (setup.phase !== "degraded" && setup.actions.includes("telegram.configure")) {
    items.push({
      id: "telegram-channel",
      label: "Configure Telegram bot token.",
      severity: "info",
      action: "configure_telegram",
    });
  } else if (setup.actions.includes("telegram.test")) {
    items.push({
      id: "telegram-channel",
      label: "Test Telegram bot before enabling the channel.",
      severity: "info",
      action: "test_telegram",
    });
  } else if (setup.actions.includes("telegram.enable")) {
    items.push({
      id: "telegram-channel",
      label: "Enable Telegram channel.",
      severity: "info",
      action: "enable_telegram",
    });
  }
  if (setup.actions.includes("setup.rerun") && setup.phase === "failed") {
    items.push({
      id: "openclaw-setup",
      label: "Rerun OpenClaw setup.",
      severity: "error",
      action: "rerun_setup",
    });
  }
  return items;
}

function expandHome(path: string): string {
  return path.replace(/^~(?=\/)/, homedir());
}
