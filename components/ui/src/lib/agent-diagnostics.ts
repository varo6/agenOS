export type AgentDiagnosticCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type AgentDiagnosticsReport = {
  generatedAt?: string;
  checks?: AgentDiagnosticCheck[];
  commands?: unknown[];
  http?: {
    probes?: Array<{
      name?: unknown;
      ok?: unknown;
      status?: unknown;
      payload?: unknown;
      error?: unknown;
    }>;
  };
} & Record<string, unknown>;

const BROKER_BASE_URL = "http://127.0.0.1:4173";
const SUPPORT_BUNDLE_URL = `${BROKER_BASE_URL}/api/diagnostics/support-bundle`;

async function readEndpoint(name: string, path: string): Promise<AgentDiagnosticCheck> {
  try {
    const response = await fetch(new URL(path, `${BROKER_BASE_URL}/`).toString(), {
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    const detail = text ? compactPayload(text) : `${response.status} ${response.statusText}`;

    return {
      name,
      ok: response.ok,
      detail,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function compactPayload(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.trim();
  }
}

export async function collectAgentDiagnostics(): Promise<AgentDiagnosticsReport> {
  try {
    const response = await fetch(SUPPORT_BUNDLE_URL, {
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as AgentDiagnosticsReport : {};

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackCheck: AgentDiagnosticCheck = {
      name: "support bundle",
      ok: false,
      detail: message,
    };
    const generatedAt = new Date().toISOString();
    const checks = await Promise.all([
      Promise.resolve(fallbackCheck),
      readEndpoint("broker /health", "/health"),
      readEndpoint("agent admin status", "/api/agent/admin/status"),
      readEndpoint("pi status", "/api/pi/status"),
    ]);

    return {
      generatedAt,
      runtime: {
        origin: globalThis.window?.location.href ?? "unknown",
        userAgent: globalThis.navigator?.userAgent ?? "unknown",
      },
      checks,
      commands: [
        "systemctl status agenos-agent-api.service",
        "systemctl status agenos-openclaw.service",
        "journalctl -u agenos-agent-api.service -n 120 --no-pager",
        "journalctl -u agenos-openclaw.service -n 120 --no-pager",
        "curl -sS http://127.0.0.1:4173/health",
        "curl -sS http://127.0.0.1:4173/api/diagnostics/support-bundle",
        "test -n \"$XDG_RUNTIME_DIR\" && cat \"$XDG_RUNTIME_DIR/agenos-system/api.log\"",
        "cat ~/.cache/agenos-system/runtime/api.log",
        "test -n \"$XDG_RUNTIME_DIR\" && cat \"$XDG_RUNTIME_DIR/agenos-installer/api.log\"",
        "cat ~/.cache/agenos-installer/runtime/api.log",
      ],
    };
  }
}
