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
