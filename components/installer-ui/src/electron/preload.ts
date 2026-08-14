import { contextBridge, ipcRenderer } from "electron";

import type {
  ApiMessageResponse,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  SystemRuntimeInfo,
} from "../shared/installer-types";
import { SYSTEM_IPC_CHANNELS, normalizeBridgeMode } from "../shared/system-services/runtime";
import { NETWORK_IPC_CHANNELS, type ConnectWifiRequest } from "../../../network/types";

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const bridgeMode = normalizeBridgeMode(process.env.AGENOS_SYSTEM_BRIDGE_MODE);

function isAvailable(): boolean {
  return bridgeMode === "ipc";
}

async function invokeOrThrow<T>(channel: string, payload?: unknown): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, payload) as T;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}

async function invokeApiMessage(channel: string, payload: unknown): Promise<ApiMessageResponse> {
  if (!isAvailable()) {
    return {
      ok: false,
      message: "El bridge IPC del sistema está desactivado.",
    };
  }

  try {
    const response = await ipcRenderer.invoke(channel, payload) as ApiMessageResponse;
    return {
      ok: response.ok,
      message: response.message ?? (response.ok ? undefined : "La operación no se pudo completar."),
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizeErrorMessage(error),
    };
  }
}

const api = {
  async getPreflight(): Promise<PreflightResponse> {
    if (!isAvailable()) {
      throw new Error("El bridge IPC del sistema está desactivado.");
    }

    return invokeOrThrow<PreflightResponse>(SYSTEM_IPC_CHANNELS.getPreflight);
  },
  async runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.runMaintenance, action);
  },
  async switchMode(mode: ShellMode): Promise<ApiMessageResponse> {
    return invokeApiMessage(SYSTEM_IPC_CHANNELS.switchMode, mode);
  },
  async getRuntimeInfo(): Promise<SystemRuntimeInfo> {
    return invokeOrThrow<SystemRuntimeInfo>(SYSTEM_IPC_CHANNELS.getRuntimeInfo);
  },
  isAvailable,
};

contextBridge.exposeInMainWorld("agenosSystem", api);

contextBridge.exposeInMainWorld(
  "__AGENOS_CAPTIVE_PORTAL_URL__",
  process.env.AGENOS_CAPTIVE_PORTAL_URL?.trim() || null,
);

contextBridge.exposeInMainWorld("agenosNetwork", {
  getStatus() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.getStatus);
  },
  scanWifi() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.scanWifi);
  },
  listAccessPoints() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.listAccessPoints);
  },
  connectWifi(request: ConnectWifiRequest) {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.connectWifi, request);
  },
  disconnectWifi() {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.disconnectWifi);
  },
  setWifiEnabled(enabled: boolean) {
    return invokeOrThrow(NETWORK_IPC_CHANNELS.setWifiEnabled, { enabled });
  },
  isAvailable,
});
