import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  PiAuthAttemptResponse,
  PiAuthMethod,
  PiChatRequest,
  PiChatResponse,
  PiPendingAttempt,
  PiStatusResponse,
  PiTurnState,
} from "../lib/pi-types";

export const DEFAULT_BROKER_BASE_URL = "http://127.0.0.1:4173";

export class BrokerApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type BrokerPiClientOptions = {
  baseUrl?: string;
  tokenPath?: string;
  fetchImpl?: typeof fetch;
  readToken?: () => string;
};

type ErrorPayload = { message?: unknown };

export function createBrokerPiClient(options: BrokerPiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? process.env.AGENOS_AGENT_API_BASE?.trim() ?? DEFAULT_BROKER_BASE_URL;
  const tokenPath = options.tokenPath
    ?? process.env.AGENOS_UI_TOKEN_PATH?.trim()
    ?? join(homedir(), ".agenos", "broker", "ui-token");
  const fetchImpl = options.fetchImpl ?? fetch;
  const readToken = options.readToken ?? (() => readFileSync(tokenPath, "utf8").trim());

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${readToken()}`);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchImpl(new URL(path, `${baseUrl}/`).toString(), {
      ...init,
      headers,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as T | ErrorPayload : undefined;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `${response.status} ${response.statusText}`;
      throw new BrokerApiError(response.status, message);
    }
    return payload as T;
  }

  return {
    getStatus(): Promise<PiStatusResponse> {
      return request("/api/pi/status");
    },
    startAuth(method: PiAuthMethod = "device"): Promise<PiPendingAttempt> {
      return request("/api/pi/auth/start", { method: "POST", body: JSON.stringify({ method }) });
    },
    async cancelAuth(attemptId?: string): Promise<void> {
      await request("/api/pi/auth/cancel", { method: "POST", body: JSON.stringify({ attemptId }) });
    },
    getAuthAttempt(attemptId: string): Promise<PiAuthAttemptResponse> {
      return request(`/api/pi/auth/attempt/${encodeURIComponent(attemptId)}`);
    },
    submitManualCode(attemptId: string, input: string): Promise<PiAuthAttemptResponse> {
      return request(`/api/pi/auth/attempt/${encodeURIComponent(attemptId)}/manual-code`, {
        method: "POST",
        body: JSON.stringify({ input }),
      });
    },
    async logout(): Promise<void> {
      await request("/api/pi/auth/logout", { method: "POST" });
    },
    chat(chatRequest: PiChatRequest): Promise<PiChatResponse> {
      return request("/api/pi/chat", { method: "POST", body: JSON.stringify(chatRequest) });
    },
    startChat(chatRequest: PiChatRequest): Promise<PiTurnState> {
      return request("/api/pi/turns", { method: "POST", body: JSON.stringify(chatRequest) });
    },
    getTurn(turnId: string): Promise<PiTurnState> {
      return request(`/api/pi/turns/${encodeURIComponent(turnId)}`);
    },
    getLatestTurn(): Promise<PiTurnState | null> {
      return request("/api/pi/turns/latest");
    },
    listTurns(limit?: number): Promise<PiTurnState[]> {
      const query = typeof limit === "number" ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return request(`/api/pi/turns${query}`);
    },
  };
}
