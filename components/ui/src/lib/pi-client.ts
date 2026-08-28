import type {
  PiAuthAttemptResponse,
  PiChatRequest,
  PiChatResponse,
  PiManualCodeRequest,
  PiPendingAttempt,
  PiStartAuthRequest,
  PiStatusResponse,
  PiTurnState,
} from "./pi-types";
import { getPiBridge } from "./pi-bridge";

const PI_API_BASE_DEFAULT = "http://127.0.0.1:4173";
const REQUEST_TIMEOUT_MS = 8_000;
// Chat turns run a full agent loop with tool calls (setup, installs, shell
// commands), so they legitimately take minutes. Progress is surfaced via
// status polling while the turn runs.
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;

type ErrorPayload = {
  message?: string;
};

export class PiClientError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function resolveHttpBase(): string {
  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:")) {
    return location.origin;
  }

  return PI_API_BASE_DEFAULT;
}

async function requestJson<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL(path, `${resolveHttpBase()}/`).toString(), {
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
      throw new PiClientError(message, response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PiClientError("La solicitud al harness excedio el tiempo limite.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function bridgeRequest<T>(operation: () => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  try {
    return await withTimeout(operation(), "La solicitud IPC al harness excedio el tiempo limite.", timeoutMs);
  } catch (error) {
    if (error instanceof PiClientError) {
      throw error;
    }

    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
    throw new PiClientError(error instanceof Error ? error.message : String(error), status);
  }
}

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new PiClientError(message)), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type PiClient = ReturnType<typeof createPiClient>;

export function createPiClient() {
  const bridge = getPiBridge();
  if (bridge?.isAvailable()) {
    return {
      getStatus(): Promise<PiStatusResponse> {
        return bridgeRequest(() => bridge.getStatus());
      },

      startAuth(method: PiStartAuthRequest["method"] = "device"): Promise<PiPendingAttempt> {
        return bridgeRequest(() => bridge.startAuth(method));
      },

      cancelAuth(attemptId?: string): Promise<void> {
        return bridgeRequest(() => bridge.cancelAuth(attemptId));
      },

      getAuthAttempt(attemptId: string): Promise<PiAuthAttemptResponse> {
        return bridgeRequest(() => bridge.getAuthAttempt(attemptId));
      },

      submitManualCode(attemptId: string, input: string): Promise<PiAuthAttemptResponse> {
        return bridgeRequest(() => bridge.submitManualCode(attemptId, input));
      },

      logout(): Promise<void> {
        return bridgeRequest(() => bridge.logout());
      },

      startNewConversation(): Promise<void> {
        return bridgeRequest(() => bridge.startNewConversation());
      },

      sendMessage(message: string, source: PiChatRequest["source"]): Promise<PiChatResponse> {
        return bridgeRequest(() => bridge.sendMessage(message, source), CHAT_TIMEOUT_MS);
      },

      startTurn(message: string, source: PiChatRequest["source"]): Promise<PiTurnState> {
        return bridgeRequest(() => bridge.startTurn(message, source));
      },

      getTurn(turnId: string): Promise<PiTurnState> {
        return bridgeRequest(() => bridge.getTurn(turnId));
      },

      cancelTurn(turnId: string): Promise<PiTurnState> {
        return bridgeRequest(() => bridge.cancelTurn(turnId));
      },

      getLatestTurn(): Promise<PiTurnState | null> {
        return bridgeRequest(() => bridge.getLatestTurn());
      },

      listTurns(limit?: number): Promise<PiTurnState[]> {
        return bridgeRequest(() => bridge.listTurns(limit));
      },
    };
  }

  return {
    getStatus(): Promise<PiStatusResponse> {
      return requestJson<PiStatusResponse>("/api/pi/status");
    },

    startAuth(method: PiStartAuthRequest["method"] = "device"): Promise<PiPendingAttempt> {
      const body: PiStartAuthRequest = { method };
      return requestJson<PiPendingAttempt>("/api/pi/auth/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },

    async cancelAuth(attemptId?: string): Promise<void> {
      await requestJson<{ ok: true }>("/api/pi/auth/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attemptId }),
      });
    },

    getAuthAttempt(attemptId: string): Promise<PiAuthAttemptResponse> {
      return requestJson<PiAuthAttemptResponse>(`/api/pi/auth/attempt/${encodeURIComponent(attemptId)}`);
    },

    submitManualCode(attemptId: string, input: string): Promise<PiAuthAttemptResponse> {
      const body: PiManualCodeRequest = { input };
      return requestJson<PiAuthAttemptResponse>(`/api/pi/auth/attempt/${encodeURIComponent(attemptId)}/manual-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },

    async logout(): Promise<void> {
      await requestJson<{ ok: true }>("/api/pi/auth/logout", {
        method: "POST",
      });
    },

    async startNewConversation(): Promise<void> {
      await requestJson<{ ok: true }>("/api/pi/conversation/new", {
        method: "POST",
      });
    },

    sendMessage(message: string, source: PiChatRequest["source"]): Promise<PiChatResponse> {
      const body: PiChatRequest = { message, source };
      return requestJson<PiChatResponse>("/api/pi/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }, CHAT_TIMEOUT_MS);
    },

    startTurn(message: string, source: PiChatRequest["source"]): Promise<PiTurnState> {
      const body: PiChatRequest = { message, source };
      return requestJson<PiTurnState>("/api/pi/turns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },

    getTurn(turnId: string): Promise<PiTurnState> {
      return requestJson<PiTurnState>(`/api/pi/turns/${encodeURIComponent(turnId)}`);
    },

    cancelTurn(turnId: string): Promise<PiTurnState> {
      return requestJson<PiTurnState>(`/api/pi/turns/${encodeURIComponent(turnId)}/cancel`, {
        method: "POST",
      });
    },

    getLatestTurn(): Promise<PiTurnState | null> {
      return requestJson<PiTurnState | null>("/api/pi/turns/latest");
    },

    listTurns(limit?: number): Promise<PiTurnState[]> {
      const query = typeof limit === "number" ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return requestJson<PiTurnState[]>(`/api/pi/turns${query}`);
    },
  };
}
