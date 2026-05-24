import type {
  AgentActionResponse,
  AgentAdminConfig,
  AgentAdminStatus,
  AgentConfirmation,
  AgentPolicyResponse,
  AgentSetupStateSummary,
} from "./system-types";

const AGENT_API_BASE_DEFAULT = "http://127.0.0.1:4173";

export type AgentAdminClientOptions = {
  baseUrl?: string;
};

type ErrorPayload = {
  message?: unknown;
  decision?: unknown;
};

function isViteDevOrigin(location: Location): boolean {
  return (
    (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    && location.port === "4174"
  );
}

function resolveHttpBase(options: AgentAdminClientOptions = {}): string {
  if (options.baseUrl) {
    return options.baseUrl;
  }

  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:") && !isViteDevOrigin(location)) {
    return location.origin;
  }

  return AGENT_API_BASE_DEFAULT;
}

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, `${baseUrl}/`).toString(), init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T | ErrorPayload : undefined;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "decision" in payload && typeof payload.decision === "string"
        ? payload.decision
        : payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload as T;
}

function postJson<T>(baseUrl: string, path: string, body: unknown = { explicitUserIntent: true }): Promise<T> {
  return requestJson<T>(baseUrl, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createAgentAdminClient(options: AgentAdminClientOptions = {}) {
  const baseUrl = resolveHttpBase(options);

  return {
    getStatus(): Promise<AgentAdminStatus> {
      return requestJson<AgentAdminStatus>(baseUrl, "/api/agent/admin/status");
    },
    getConfig(): Promise<AgentAdminConfig> {
      return requestJson<AgentAdminConfig>(baseUrl, "/api/agent/admin/config");
    },
    getPolicy(): Promise<AgentPolicyResponse> {
      return requestJson<AgentPolicyResponse>(baseUrl, "/api/agent/admin/policy");
    },
    updateConfig(patch: Partial<AgentAdminConfig>): Promise<AgentActionResponse> {
      return postJson<AgentActionResponse>(baseUrl, "/api/agent/admin/config", {
        ...patch,
        explicitUserIntent: true,
      });
    },
    restart(): Promise<AgentActionResponse> {
      return postJson<AgentActionResponse>(baseUrl, "/api/agent/admin/restart");
    },
    testConnection(): Promise<AgentActionResponse & { readiness?: AgentAdminStatus["readiness"] }> {
      return postJson<AgentActionResponse & { readiness?: AgentAdminStatus["readiness"] }>(
        baseUrl,
        "/api/agent/admin/test-connection",
      );
    },
    getSetupStatus(): Promise<AgentSetupStateSummary & AgentActionResponse> {
      return requestJson<AgentSetupStateSummary & AgentActionResponse>(baseUrl, "/api/agent/setup/status");
    },
    rerunSetup(): Promise<AgentSetupStateSummary & AgentActionResponse> {
      return postJson<AgentSetupStateSummary & AgentActionResponse>(baseUrl, "/api/agent/setup/run");
    },
    startBackendCodexLogin(): Promise<AgentSetupStateSummary & AgentActionResponse & { command?: string[] }> {
      return postJson<AgentSetupStateSummary & AgentActionResponse & { command?: string[] }>(
        baseUrl,
        "/api/agent/auth/codex/start",
      );
    },
    configureTelegram(token: string): Promise<AgentSetupStateSummary & AgentActionResponse> {
      return postJson<AgentSetupStateSummary & AgentActionResponse>(
        baseUrl,
        "/api/agent/channels/telegram/configure",
        { token, explicitUserIntent: true },
      );
    },
    testTelegram(): Promise<AgentSetupStateSummary & AgentActionResponse> {
      return postJson<AgentSetupStateSummary & AgentActionResponse>(baseUrl, "/api/agent/channels/telegram/test");
    },
    enableTelegram(): Promise<AgentSetupStateSummary & AgentActionResponse> {
      return postJson<AgentSetupStateSummary & AgentActionResponse>(baseUrl, "/api/agent/channels/telegram/enable");
    },
    retryTask(taskId: string): Promise<AgentActionResponse> {
      return postJson<AgentActionResponse>(baseUrl, `/api/agent/admin/tasks/${encodeURIComponent(taskId)}/retry`);
    },
    clearTask(taskId: string): Promise<AgentActionResponse> {
      return postJson<AgentActionResponse>(baseUrl, `/api/agent/admin/tasks/${encodeURIComponent(taskId)}/clear`);
    },
    exportDiagnostics(): Promise<Record<string, unknown>> {
      return postJson<Record<string, unknown>>(baseUrl, "/api/agent/admin/export-diagnostics");
    },
    listConfirmations(): Promise<AgentConfirmation[]> {
      return requestJson<AgentConfirmation[]>(baseUrl, "/api/agent/confirmations");
    },
    confirm(confirmationId: string): Promise<AgentActionResponse> {
      return postJson<AgentActionResponse>(baseUrl, `/api/agent/confirmations/${encodeURIComponent(confirmationId)}/confirm`);
    },
    deny(confirmationId: string): Promise<AgentActionResponse> {
      return postJson<AgentActionResponse>(baseUrl, `/api/agent/confirmations/${encodeURIComponent(confirmationId)}/deny`);
    },
  };
}
