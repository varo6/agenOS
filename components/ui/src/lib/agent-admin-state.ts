import type { AgentAdminConfig, AgentAdminStatus } from "./system-types";

export type BackendReadiness = Pick<AgentAdminStatus, "readiness" | "setupItems">;

export type AgentAdminState = {
  loading: boolean;
  status: AgentAdminStatus | null;
  configDraft: AgentAdminConfig | null;
  pendingConfirmation: { confirmationId?: string; message?: string } | null;
  lastMessage: string | null;
  diagnostics: Record<string, unknown> | null;
  error: string | null;
};

export type AgentAdminAction =
  | { type: "status.loaded"; status: AgentAdminStatus }
  | { type: "config.patch"; patch: Partial<AgentAdminConfig> }
  | { type: "confirmation.required"; confirmationId?: string; message?: string }
  | { type: "task.action.completed"; message: string }
  | { type: "diagnostics.exported"; diagnostics: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "loading"; loading: boolean };

export function createAgentAdminInitialState(): AgentAdminState {
  return {
    loading: false,
    status: null,
    configDraft: null,
    pendingConfirmation: null,
    lastMessage: null,
    diagnostics: null,
    error: null,
  };
}

export function agentAdminReducer(state: AgentAdminState, action: AgentAdminAction): AgentAdminState {
  switch (action.type) {
    case "status.loaded":
      return {
        ...state,
        loading: false,
        status: action.status,
        configDraft: action.status.config,
        error: null,
      };
    case "config.patch":
      return {
        ...state,
        configDraft: {
          ...state.configDraft,
          ...action.patch,
        } as AgentAdminConfig,
      };
    case "confirmation.required":
      return {
        ...state,
        pendingConfirmation: {
          confirmationId: action.confirmationId,
          message: action.message,
        },
      };
    case "task.action.completed":
      return {
        ...state,
        lastMessage: action.message,
        error: null,
      };
    case "diagnostics.exported":
      return {
        ...state,
        diagnostics: action.diagnostics,
        lastMessage: "Diagnostics exported.",
        error: null,
      };
    case "error":
      return {
        ...state,
        loading: false,
        error: action.message,
      };
    case "loading":
      return {
        ...state,
        loading: action.loading,
      };
  }
}

export function deriveBackendReadiness(status: Pick<AgentAdminStatus, "worker" | "config">): BackendReadiness {
  if (status.worker.mode === "local-simulated" || status.config.mode === "local-simulated") {
    return {
      readiness: "degraded",
      setupItems: [{
        id: "local-simulated",
        label: "Modo simulado activo",
        severity: "info",
        action: "switch_mode",
      }],
    };
  }

  const setupItems: AgentAdminStatus["setupItems"] = [];
  if (status.config.apiAuth.type === "env" && !status.config.apiAuth.configured) {
    setupItems.push({
      id: "provider-auth",
      label: "Configura API auth",
      severity: "warning",
      action: "configure_provider",
    });
  }

  if (!status.worker.serviceActive) {
    setupItems.push({
      id: "worker-service",
      label: "Servicio de worker inactivo",
      severity: "error",
      action: "view_logs",
    });
  }

  if (setupItems.length > 0) {
    return { readiness: "needs_setup", setupItems };
  }

  if (status.worker.degradedReason) {
    return {
      readiness: "degraded",
      setupItems: [{
        id: "degraded-reason",
        label: status.worker.degradedReason,
        severity: "warning",
        action: "view_logs",
      }],
    };
  }

  return { readiness: "ready", setupItems: [] };
}
