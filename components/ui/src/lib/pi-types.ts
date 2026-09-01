export const PI_DEV_HARNESS_ORIGIN = "http://127.0.0.1:4174";

export type PiAuthState = "disconnected" | "authorizing" | "connected" | "error";
export type PiAuthMethod = "device" | "browser";
export type PiChatSource = "text" | "voice";
export type PiModelId = "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna" | "gpt-5.5";
export type PiReasoningLevel = "off" | "low" | "medium" | "high";
export type PiAuthAttemptStatus = "pending" | "success" | "error" | "expired" | "cancelled";

export type PiPendingAttempt = {
  attemptId: string;
  method: PiAuthMethod;
  url: string;
  instructions: string;
  expiresAt: string;
  userCode?: string;
};

export type PiTurnProgress = {
  startedAt: string;
  streamedText: string;
  currentTool: string | null;
  currentToolMessage?: string;
  completedTools: string[];
};

export type PiTurnStatus = "processing" | "succeeded" | "cancelled" | "failed";

export type PiTurnState = {
  turnId: string;
  status: PiTurnStatus;
  source: PiChatSource;
  input: string;
  startedAt: string;
  finishedAt?: string;
  progress: PiTurnProgress;
  reply?: string;
  modelId?: string;
  error?: string;
  errorStatus?: number;
};

export type PiStatusResponse = {
  authState: PiAuthState;
  providerName: string;
  modelId: string;
  reasoningLevel?: PiReasoningLevel;
  busy: boolean;
  pendingAttempt?: PiPendingAttempt;
  turn?: PiTurnProgress;
  error?: string;
};

export type PiConfigurationRequest = {
  modelId: PiModelId;
  reasoningLevel: PiReasoningLevel;
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
