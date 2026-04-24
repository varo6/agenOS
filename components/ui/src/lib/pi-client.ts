import type {
  PiAuthAttemptResponse,
  PiChatRequest,
  PiChatResponse,
  PiManualCodeRequest,
  PiPendingAttempt,
  PiStatusResponse,
} from "./pi-types";
import { getPiBridge } from "./pi-bridge";

const PI_API_BASE_DEFAULT = "http://127.0.0.1:4173";

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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, `${resolveHttpBase()}/`).toString(), init);
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
}

async function bridgeRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
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

export type PiClient = ReturnType<typeof createPiClient>;

export function createPiClient() {
  const bridge = getPiBridge();
  if (bridge?.isAvailable()) {
    return {
      getStatus(): Promise<PiStatusResponse> {
        return bridgeRequest(() => bridge.getStatus());
      },

      startAuth(): Promise<PiPendingAttempt> {
        return bridgeRequest(() => bridge.startAuth());
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

      sendMessage(message: string, source: PiChatRequest["source"]): Promise<PiChatResponse> {
        return bridgeRequest(() => bridge.sendMessage(message, source));
      },
    };
  }

  return {
    getStatus(): Promise<PiStatusResponse> {
      return requestJson<PiStatusResponse>("/api/pi/status");
    },

    startAuth(): Promise<PiPendingAttempt> {
      return requestJson<PiPendingAttempt>("/api/pi/auth/start", {
        method: "POST",
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

    sendMessage(message: string, source: PiChatRequest["source"]): Promise<PiChatResponse> {
      const body: PiChatRequest = { message, source };
      return requestJson<PiChatResponse>("/api/pi/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },
  };
}
