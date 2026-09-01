import type {
  PiAuthAttemptResponse,
  PiChatResponse,
  PiPendingAttempt,
  PiStartAuthRequest,
  PiStatusResponse,
  PiConfigurationRequest,
  PiTurnState,
} from "./pi-types";

export type AgenosPiBridge = {
  getStatus(): Promise<PiStatusResponse>;
  setConfiguration(configuration: PiConfigurationRequest): Promise<PiStatusResponse>;
  startAuth(method?: PiStartAuthRequest["method"]): Promise<PiPendingAttempt>;
  cancelAuth(attemptId?: string): Promise<void>;
  getAuthAttempt(attemptId: string): Promise<PiAuthAttemptResponse>;
  submitManualCode(attemptId: string, input: string): Promise<PiAuthAttemptResponse>;
  logout(): Promise<void>;
  startNewConversation(): Promise<void>;
  sendMessage(message: string, source: "text" | "voice"): Promise<PiChatResponse>;
  startTurn(message: string, source: "text" | "voice"): Promise<PiTurnState>;
  getTurn(turnId: string): Promise<PiTurnState>;
  cancelTurn(turnId: string): Promise<PiTurnState>;
  getLatestTurn(): Promise<PiTurnState | null>;
  listTurns(limit?: number): Promise<PiTurnState[]>;
  isAvailable(): boolean;
};

export function getPiBridge(): AgenosPiBridge | null {
  const candidate = globalThis.window?.agenosPi;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
