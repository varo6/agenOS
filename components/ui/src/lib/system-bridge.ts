import type {
  ApiMessageResponse,
  DisplayStatus,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  SystemRuntimeInfo,
} from "./system-types";

export type AgenosSystemBridge = {
  getPreflight(): Promise<PreflightResponse>;
  runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse>;
  switchMode(mode: ShellMode): Promise<ApiMessageResponse>;
  getRuntimeInfo(): Promise<SystemRuntimeInfo>;
  getDisplayStatus(): Promise<DisplayStatus>;
  setBrightness(percent: number): Promise<ApiMessageResponse>;
  turnOffDisplay(): Promise<ApiMessageResponse>;
  isAvailable(): boolean;
};

export function getSystemBridge(): AgenosSystemBridge | null {
  const candidate = globalThis.window?.agenosSystem;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
