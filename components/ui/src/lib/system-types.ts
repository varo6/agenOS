export type FirmwareType = "UEFI" | "BIOS";
export type ShellMode = "installer" | "system";
export type MaintenanceAction = "terminal";
export type SystemBridgeMode = "ipc" | "http";
export type SystemRuntimeHost = "electron" | "web";
export type GpuState = "on" | "off";

export type PreflightCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

export type PreflightResponse = {
  firmware: FirmwareType;
  isLiveSession: boolean;
  totalRamBytes: number;
  installableDiskBytes: number;
  checks: PreflightCheck[];
};

export type ApiMessageResponse = {
  ok: boolean;
  message?: string;
};

export type DisplayStatus = {
  available: boolean;
  brightnessPercent: number | null;
};

export type AudioStatus = {
  available: boolean;
  volumePercent: number | null;
  muted: boolean;
};

export type SystemRuntimeInfo = {
  mode: SystemBridgeMode;
  host: SystemRuntimeHost;
  gpu: GpuState;
  version: string;
};

export type AgentMemoryNamespace = "contacts" | "preferences" | "facts";

export type AgentMemoryResponse = {
  namespace: AgentMemoryNamespace;
  content: string;
};

export type AgentActionResponse = {
  ok: boolean;
  message?: string;
};

export type AgentShellExecResponse = AgentActionResponse & {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type AgentTaskResponse = AgentActionResponse & {
  taskId?: string;
};

export type AgentWorkspaceNumber = 1 | 2 | 3 | 4 | 5;

export type AgentWorkspace = {
  number: AgentWorkspaceNumber;
  name: string;
  label: string;
};

export type AgentWorkspaceListResponse = {
  ok: true;
  workspaces: AgentWorkspace[];
  activeWorkspace?: AgentWorkspaceNumber;
};

export type AgentWorkspaceFocusResponse = AgentActionResponse & {
  workspaces: AgentWorkspace[];
  activeWorkspace?: AgentWorkspaceNumber;
};

export type AgentWorkerMode = "openclaw-process" | "agenos-bun-worker" | "local-simulated";

export type AgentAdminConfig = {
  mode: "auto" | AgentWorkerMode;
  provider: string;
  model: string;
  stateDir: string;
  apiAuth: { type: "none"; configured?: boolean } | { type: "env"; envVar: string; configured: boolean };
  channels: { email: boolean; telegram: boolean; whatsapp: boolean };
  policyDefaults: { memoryWrite: "confirm"; outboundSend: "confirm" };
};

export type AgentAdminStatus = {
  ok: boolean;
  readiness: "ready" | "degraded" | "needs_setup";
  setupItems: Array<{
    id: string;
    label: string;
    severity: "info" | "warning" | "error";
    action:
      | "configure_provider"
      | "test_connection"
      | "switch_mode"
      | "view_logs"
      | "connect_backend_codex"
      | "configure_telegram"
      | "test_telegram"
      | "enable_telegram"
      | "rerun_setup";
  }>;
  setup?: AgentSetupStateSummary;
  worker: {
    mode: AgentWorkerMode;
    serviceActive: boolean;
    version: string;
    queueDepth: number;
    degradedReason: string | null;
    lastHeartbeatAt: string | null;
    lastError: string | null;
    lastErrorCorrelationId: string | null;
  };
  config: AgentAdminConfig;
};

export type AgentSetupStateSummary = {
  phase: "ready" | "needs_auth" | "needs_channel" | "degraded" | "failed";
  message: string;
  actions: Array<
    | "setup.rerun"
    | "codex.login"
    | "telegram.configure"
    | "telegram.test"
    | "telegram.enable"
    | "diagnostics.export"
  >;
  codex?: {
    configured: boolean;
    profile?: string | null;
    loginAvailable?: boolean;
    lastError?: string | null;
  };
  telegram?: {
    enabled: boolean;
    tokenConfigured: boolean;
    botUsername?: string | null;
    lastTestOk?: boolean | null;
    lastError?: string | null;
  };
};

export type AgentPolicyRule = {
  ruleId: string;
  tool: string;
  source: string;
  decision: "allow" | "confirm" | "deny";
  reason: string;
};

export type AgentPolicyResponse = {
  defaults?: AgentAdminConfig["policyDefaults"];
  rules: AgentPolicyRule[];
};

export type AgentConfirmation = {
  schemaVersion: 1;
  confirmationId: string;
  correlationId: string;
  timestamp: string;
  status: "pending" | "confirmed" | "denied";
  source: "ui" | "openclaw" | "system";
  tool: string;
  summary: string;
  input: unknown;
};

export type AgentConfirmationRequiredResponse = {
  ok: false;
  decision: "confirm";
  confirmationId?: string;
  message?: string;
};

export type LearnedMemoryKind = "preference" | "procedure" | "avoidance";

export type LearnedMemoryItem = {
  schemaVersion: 1;
  itemId: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "deleted";
  kind: LearnedMemoryKind;
  statement: string;
  confidence: number;
  expiresAt: string;
  sourceSignalIds: string[];
  userEdited: boolean;
};

export type LearningOverview = {
  signalsCaptured: number;
  turnsObserved: number;
  turnsWithMemory: number;
  memoryUses: number;
  activeMemories: number;
  pendingProposals: number;
  acceptedProposals: number;
  deniedProposals: number;
  acceptanceRate: number | null;
  lastLearningAt: string | null;
  usageByItem: Record<string, { count: number; lastUsedAt: string }>;
};
