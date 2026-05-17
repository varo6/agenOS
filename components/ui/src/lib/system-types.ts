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

export type AgentTaskResponse = AgentActionResponse & {
  taskId?: string;
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
    action: "configure_provider" | "test_connection" | "switch_mode" | "view_logs";
  }>;
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
