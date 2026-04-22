import type {
  ApiMessageResponse,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  SystemRuntimeInfo,
} from "../../../installer-ui/src/shared/installer-types";
import { getSystemBridge } from "./system-bridge";

const INSTALLER_API_BASE_DEFAULT = "http://127.0.0.1:4173";
const INSTALLER_ROUTES = {
  preflight: "/api/installer/preflight",
  switchMode: "/api/installer/switch-mode",
  systemMaintenance: "/api/system/maintenance",
} as const;

export type SystemClient = {
  getPreflight(): Promise<PreflightResponse>;
  runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse>;
  switchMode(mode: ShellMode): Promise<ApiMessageResponse>;
  getRuntimeInfo(): Promise<SystemRuntimeInfo>;
};

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveHttpBase(): string {
  const location = globalThis.window?.location;
  if (location && (location.protocol === "http:" || location.protocol === "https:")) {
    return location.origin;
  }

  return INSTALLER_API_BASE_DEFAULT;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, `${resolveHttpBase()}/`).toString(), init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T | ApiMessageResponse : undefined;

  if (!response.ok) {
    if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
      throw new Error(payload.message);
    }

    throw new Error(`${response.status} ${response.statusText}`);
  }

  return payload as T;
}

function createHttpClient(): SystemClient {
  return {
    getPreflight() {
      return requestJson<PreflightResponse>(INSTALLER_ROUTES.preflight);
    },
    runMaintenance(action) {
      return requestJson<ApiMessageResponse>(INSTALLER_ROUTES.systemMaintenance, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
    },
    switchMode(mode) {
      return requestJson<ApiMessageResponse>(INSTALLER_ROUTES.switchMode, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      });
    },
    async getRuntimeInfo() {
      const bridge = getSystemBridge();
      if (bridge) {
        try {
          return await bridge.getRuntimeInfo();
        } catch {
          return {
            mode: "http",
            host: "electron",
            gpu: "off",
            version: "unknown",
          } satisfies SystemRuntimeInfo;
        }
      }

      return {
        mode: "http",
        host: "web",
        gpu: "off",
        version: "dev",
      } satisfies SystemRuntimeInfo;
    },
  };
}

function createIpcClient(): SystemClient {
  const bridge = getSystemBridge();
  if (!bridge) {
    throw new Error("El bridge IPC no está disponible.");
  }

  return {
    getPreflight() {
      return bridge.getPreflight();
    },
    async runMaintenance(action) {
      const response = await bridge.runMaintenance(action);
      if (!response.ok) {
        throw new Error(response.message ?? "No se pudo ejecutar la acción de mantenimiento.");
      }

      return response;
    },
    async switchMode(mode) {
      const response = await bridge.switchMode(mode);
      if (!response.ok) {
        throw new Error(response.message ?? "No se pudo cambiar el modo.");
      }

      return response;
    },
    getRuntimeInfo() {
      return bridge.getRuntimeInfo();
    },
  };
}

export function createSystemClient(): SystemClient {
  const bridge = getSystemBridge();
  if (bridge?.isAvailable()) {
    return createIpcClient();
  }

  return createHttpClient();
}

export function describeSystemClientFailure(error: unknown): string {
  return normalizeErrorMessage(error);
}
