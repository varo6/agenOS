import type {
  PiAuthAttemptResponse,
  PiChatRequest,
  PiChatResponse,
  PiManualCodeRequest,
  PiPendingAttempt,
  PiStatusResponse,
} from "./pi-types";
import { PI_DEV_HARNESS_ORIGIN } from "./pi-types";

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

function ensureHarnessOrigin(): string {
  const origin = globalThis.window?.location?.origin;
  if (origin !== PI_DEV_HARNESS_ORIGIN) {
    throw new PiClientError("Harness de desarrollo no disponible.");
  }

  return origin;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = ensureHarnessOrigin();
  const response = await fetch(new URL(path, `${origin}/`).toString(), init);
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

export type PiClient = ReturnType<typeof createPiClient>;

export function createPiClient() {
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
