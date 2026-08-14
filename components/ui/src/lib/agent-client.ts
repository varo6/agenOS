import type {
  AgentActionResponse,
  AgentMemoryNamespace,
  AgentMemoryResponse,
  AgentShellExecResponse,
  AgentTaskResponse,
  AgentWorkspaceFocusResponse,
  AgentWorkspaceListResponse,
  AgentWorkspaceNumber,
} from "./system-types";

const AGENT_API_BASE_DEFAULT = "http://127.0.0.1:4173";
const REQUEST_TIMEOUT_MS = 8_000;
const GRAPHICAL_LAUNCH_TIMEOUT_MS = 20_000;

type ErrorPayload = {
  message?: unknown;
};

export type AgentClientOptions = {
  baseUrl?: string;
  eventSourceFactory?: (url: string) => EventSource;
};

function isViteDevOrigin(location: Location): boolean {
  return (
    (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    && location.port === "4174"
  );
}

function resolveHttpBase(options: AgentClientOptions = {}): string {
  if (options.baseUrl) {
    return options.baseUrl;
  }

  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:") && !isViteDevOrigin(location)) {
    return location.origin;
  }

  return AGENT_API_BASE_DEFAULT;
}

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL(path, `${baseUrl}/`).toString(), {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as T | ErrorPayload : undefined;

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("La solicitud al broker excedio el tiempo limite.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function createAgentClient(options: AgentClientOptions = {}) {
  const baseUrl = resolveHttpBase(options);

  return {
    readMemory(namespace: AgentMemoryNamespace): Promise<AgentMemoryResponse> {
      return requestJson<AgentMemoryResponse>(baseUrl, `/api/agent/memory/${encodeURIComponent(namespace)}`);
    },
    appendMemory(namespace: AgentMemoryNamespace, content: string): Promise<AgentActionResponse> {
      return requestJson<AgentActionResponse>(baseUrl, `/api/agent/memory/${encodeURIComponent(namespace)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source: "ui", explicitUserIntent: true }),
      });
    },
    delegateBackgroundTask(message: string): Promise<AgentTaskResponse> {
      return requestJson<AgentTaskResponse>(baseUrl, "/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, source: "ui" }),
      });
    },
    openBrowserUrl(url: string): Promise<AgentActionResponse> {
      return requestJson<AgentActionResponse>(baseUrl, "/api/agent/browser/open-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }, GRAPHICAL_LAUNCH_TIMEOUT_MS);
    },
    openApp(app: string, options: { workspace?: AgentWorkspaceNumber; focus?: boolean } = {}): Promise<AgentActionResponse> {
      return requestJson<AgentActionResponse>(baseUrl, "/api/agent/apps/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, ...options }),
      }, GRAPHICAL_LAUNCH_TIMEOUT_MS);
    },
    listWorkspaces(): Promise<AgentWorkspaceListResponse> {
      return requestJson<AgentWorkspaceListResponse>(baseUrl, "/api/agent/workspaces");
    },
    subscribeWorkspaceChanges(onChange: (state: AgentWorkspaceListResponse) => void): () => void {
      const createEventSource = options.eventSourceFactory
        ?? ((url: string) => new EventSource(url));
      const eventSource = createEventSource(new URL("/api/agent/workspaces/events", `${baseUrl}/`).toString());
      eventSource.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data) as AgentWorkspaceListResponse;
          if (state.ok === true && Array.isArray(state.workspaces)) {
            onChange(state);
          }
        } catch {
          // EventSource reconnects automatically; ignore malformed individual frames.
        }
      };

      return () => {
        eventSource.close();
      };
    },
    focusWorkspace(workspace: AgentWorkspaceNumber): Promise<AgentWorkspaceFocusResponse> {
      return requestJson<AgentWorkspaceFocusResponse>(baseUrl, "/api/agent/workspaces/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, source: "ui" }),
      });
    },
    executeShell(command: string, cwd?: string, timeoutMs?: number): Promise<AgentShellExecResponse> {
      return requestJson<AgentShellExecResponse>(baseUrl, "/api/agent/shell/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, cwd, timeoutMs }),
      });
    },
  };
}
