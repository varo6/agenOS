import type {
  ApiMessageResponse,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  SystemRuntimeInfo,
} from "../../../installer-ui/src/shared/installer-types";

export type AgenosSystemBridge = {
  getPreflight(): Promise<PreflightResponse>;
  runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse>;
  switchMode(mode: ShellMode): Promise<ApiMessageResponse>;
  getRuntimeInfo(): Promise<SystemRuntimeInfo>;
  isAvailable(): boolean;
};

export function getSystemBridge(): AgenosSystemBridge | null {
  const candidate = globalThis.window?.agenosSystem;
  if (!candidate) {
    return null;
  }

  return typeof candidate.isAvailable === "function" ? candidate : null;
}
