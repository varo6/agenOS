export const PI_DEV_HARNESS_ORIGIN = "http://127.0.0.1:4174";

export type PiAuthState = "disconnected" | "authorizing" | "connected" | "error";
export type PiAuthMethod = "device" | "browser";
export type PiChatSource = "text" | "voice";
export type PiAuthAttemptStatus = "pending" | "success" | "error" | "expired";

export type PiPendingAttempt = {
  attemptId: string;
  method: PiAuthMethod;
  url: string;
  instructions: string;
  expiresAt: string;
  userCode?: string;
};

export type PiStatusResponse = {
  authState: PiAuthState;
  providerName: string;
  modelId: string;
  busy: boolean;
  pendingAttempt?: PiPendingAttempt;
  error?: string;
};

export type PiAuthAttemptResponse = {
  attemptId: string;
  method: PiAuthMethod;
  status: PiAuthAttemptStatus;
  url?: string;
  instructions?: string;
  expiresAt: string;
  userCode?: string;
  error?: string;
};

export type PiStartAuthRequest = {
  method?: PiAuthMethod;
};

export type PiManualCodeRequest = {
  input: string;
};

export type PiChatRequest = {
  message: string;
  source: PiChatSource;
};

export type PiChatResponse = {
  ok: boolean;
  reply?: string;
  provider: "openai-codex";
  modelId: string;
  message?: string;
};
