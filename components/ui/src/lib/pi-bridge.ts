import type {
  PiAuthAttemptResponse,
  PiChatResponse,
  PiPendingAttempt,
  PiStartAuthRequest,
  PiStatusResponse,
} from "./pi-types";

export type AgenosPiBridge = {
  getStatus(): Promise<PiStatusResponse>;
  startAuth(method?: PiStartAuthRequest["method"]): Promise<PiPendingAttempt>;
  getAuthAttempt(attemptId: string): Promise<PiAuthAttemptResponse>;
  submitManualCode(attemptId: string, input: string): Promise<PiAuthAttemptResponse>;
  logout(): Promise<void>;
  sendMessage(message: string, source: "text" | "voice"): Promise<PiChatResponse>;
  isAvailable(): boolean;
};

export function getPiBridge(): AgenosPiBridge | null {
  const candidate = globalThis.window?.agenosPi;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
