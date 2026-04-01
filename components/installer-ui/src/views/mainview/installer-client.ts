import type {
  ApiMessageResponse,
  DiskSummary,
  InstallerProfilePayload,
  LaunchResponse,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  ValidationResponse,
} from "../../shared/installer-types";
import {
  INSTALLER_ROUTES,
  installerRouteUrl,
  resolveInstallerApiBase,
} from "../../shared/installer-http";

const apiBase = resolveInstallerApiBase(import.meta.env.VITE_INSTALLER_API_BASE);

type JsonBody = Record<string, unknown> | string | number | boolean | null | unknown[];

function formatHttpErrorBody(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }

  if (body !== undefined) {
    return JSON.stringify(body);
  }

  return fallback;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function httpFailure(prefix: string, status: number, body: unknown, statusText: string): Error {
  return new Error(`${prefix} devolvió ${status}: ${formatHttpErrorBody(body, statusText || "Error HTTP")}`);
}

function requestFailure(prefix: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${prefix} falló: ${error.message}`);
  }
  return new Error(`${prefix} falló: ${String(error)}`);
}

async function requestJson<ResponseBody>(
  method: "GET" | "POST",
  path: string,
  body?: JsonBody,
): Promise<ResponseBody> {
  const prefix = `${method} ${path}`;

  let response: Response;
  try {
    response = await fetch(installerRouteUrl(path, apiBase), {
      method,
      headers: body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
          },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw requestFailure(prefix, error);
  }

  const payload = await parseJsonBody(response);
  if (!response.ok) {
    throw httpFailure(prefix, response.status, payload, response.statusText);
  }

  return payload as ResponseBody;
}

export const installerClient = {
  async getPreflight(): Promise<PreflightResponse> {
    return requestJson<PreflightResponse>("GET", INSTALLER_ROUTES.preflight);
  },

  async getDisks(): Promise<DiskSummary[]> {
    return requestJson<DiskSummary[]>("GET", INSTALLER_ROUTES.disks);
  },

  async validateProfile(profile: InstallerProfilePayload): Promise<ValidationResponse> {
    return requestJson<ValidationResponse>("POST", INSTALLER_ROUTES.validateProfile, profile);
  },

  async launchGuided(profile: InstallerProfilePayload): Promise<LaunchResponse> {
    const prefix = `POST ${INSTALLER_ROUTES.startGuided}`;
    const response = await requestJson<LaunchResponse>("POST", INSTALLER_ROUTES.startGuided, profile);
    if (!response.ok) {
      throw new Error(`${prefix} devolvió 500: ${JSON.stringify(response)}`);
    }
    return response;
  },

  async launchClassic(): Promise<LaunchResponse> {
    const prefix = `POST ${INSTALLER_ROUTES.startClassic}`;
    const response = await requestJson<LaunchResponse>("POST", INSTALLER_ROUTES.startClassic);
    if (!response.ok) {
      throw new Error(`${prefix} devolvió 500: ${JSON.stringify(response)}`);
    }
    return response;
  },

  async switchMode(mode: ShellMode): Promise<ApiMessageResponse> {
    const prefix = `POST ${INSTALLER_ROUTES.switchMode}`;
    const response = await requestJson<ApiMessageResponse>("POST", INSTALLER_ROUTES.switchMode, { mode });
    if (!response.ok) {
      throw new Error(`${prefix} devolvió 500: ${JSON.stringify(response)}`);
    }
    return response;
  },

  async runMaintenance(action: MaintenanceAction): Promise<ApiMessageResponse> {
    const prefix = `POST ${INSTALLER_ROUTES.systemMaintenance}`;
    const response = await requestJson<ApiMessageResponse>("POST", INSTALLER_ROUTES.systemMaintenance, { action });
    if (!response.ok) {
      throw new Error(`${prefix} devolvió 500: ${JSON.stringify(response)}`);
    }
    return response;
  },
};
