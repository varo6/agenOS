import type { AgentConfirmation } from "./system-types";
import type { WorkerTask, WorkerProgressEvent } from "../../../installer-ui/src/bun/agent/worker/types";

export type { WorkerTask, WorkerProgressEvent };
export type ConfirmationDecision = "confirm" | "deny";
export type ConfirmationResult = { ok: boolean; message?: string };
export type ActivityClient = {
  listConfirmations(): Promise<AgentConfirmation[]>;
  listTasks(): Promise<WorkerTask[]>;
  taskEvents(taskId: string): Promise<WorkerProgressEvent[]>;
  resolve(confirmationId: string, decision: ConfirmationDecision): Promise<ConfirmationResult>;
};
export type ActivityBridge = ActivityClient & { isAvailable(): boolean };

declare global {
  interface Window { agenosActivity?: ActivityBridge; }
}

export function createActivityClient(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): ActivityClient {
  const location = globalThis.window?.location;
  const baseUrl = options.baseUrl ?? (location?.protocol.startsWith("http") && location.port !== "4174"
    ? location.origin : "http://127.0.0.1:4173");
  const bridge = !options.baseUrl && !options.fetchImpl ? globalThis.window?.agenosActivity : undefined;

  async function request<T>(path: string, decision?: ConfirmationDecision): Promise<T> {
    const response = await (options.fetchImpl ?? fetch)(new URL(path, baseUrl), {
      credentials: "include",
      signal: AbortSignal.timeout(decision ? 120_000 : 8_000),
      ...(decision ? {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ explicitUserIntent: true }),
      } : {}),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message : `Error ${response.status}`);
    return payload as T;
  }

  return {
    listConfirmations: () => bridge?.isAvailable() ? bridge.listConfirmations() : request("/api/agent/confirmations"),
    listTasks: () => bridge?.isAvailable() ? bridge.listTasks() : request("/api/agent/tasks?limit=50"),
    taskEvents: (taskId) => bridge?.isAvailable() ? bridge.taskEvents(taskId)
      : request(`/api/agent/tasks/${encodeURIComponent(taskId)}/events`),
    resolve: (id, decision) => bridge?.isAvailable() ? bridge.resolve(id, decision)
      : request(`/api/agent/confirmations/${encodeURIComponent(id)}/${decision}`, decision),
  };
}
