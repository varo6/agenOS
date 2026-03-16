import type {
  DiskSummary,
  InstallerProfilePayload,
  LaunchResponse,
  PreflightResponse,
  ValidationResponse,
} from "../shared/installer-types";
import {
  INSTALLER_API_HOST,
  INSTALLER_API_PORT,
  INSTALLER_ROUTES,
} from "../shared/installer-http";
import { HttpError, json, methodNotAllowed, options, readJsonBody } from "./http";
import { discoverDisks } from "./installer/disks";
import { launchClassic, launchGuided } from "./installer/launch";
import { readPreflightPayload } from "./installer/preflight";
import { validateProfile } from "./installer/validate-profile";

export type InstallerApiDependencies = {
  getPreflight: () => PreflightResponse;
  getDisks: () => DiskSummary[];
  validateProfile: (payload: unknown) => ValidationResponse;
  launchGuided: (profile: InstallerProfilePayload) => Promise<LaunchResponse>;
  launchClassic: () => Promise<LaunchResponse>;
};

function defaultValidationResponse(payload: unknown): ValidationResponse {
  const result = validateProfile(payload);
  return {
    ok: Object.keys(result.errors).length === 0,
    errors: result.errors,
    normalizedProfile: result.normalizedProfile ?? undefined,
  };
}

function isPermissionDenied(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  return /denied|denegad|not authorized|cancelled/i.test(message);
}

function launchFailureStatus(response: LaunchResponse, defaultStatus: number): number {
  if (response.errors && Object.keys(response.errors).length > 0) {
    return 422;
  }

  if (isPermissionDenied(response.message)) {
    return 403;
  }

  return defaultStatus;
}

export function createInstallerApiHandler(
  dependencies: Partial<InstallerApiDependencies> = {},
): { fetch: (request: Request) => Promise<Response> } {
  const deps: InstallerApiDependencies = {
    getPreflight: dependencies.getPreflight ?? readPreflightPayload,
    getDisks: dependencies.getDisks ?? discoverDisks,
    validateProfile: dependencies.validateProfile ?? defaultValidationResponse,
    launchGuided: dependencies.launchGuided ?? launchGuided,
    launchClassic: dependencies.launchClassic ?? launchClassic,
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      try {
        if (request.method === "OPTIONS") {
          return options(["GET", "POST", "OPTIONS"]);
        }

        if (url.pathname === INSTALLER_ROUTES.health) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          return json({ ok: true });
        }

        if (url.pathname === INSTALLER_ROUTES.preflight) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          return json(deps.getPreflight());
        }

        if (url.pathname === INSTALLER_ROUTES.disks) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          return json(deps.getDisks());
        }

        if (url.pathname === INSTALLER_ROUTES.validateProfile) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          return json(deps.validateProfile(await readJsonBody(request)));
        }

        if (url.pathname === INSTALLER_ROUTES.startGuided) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const response = await deps.launchGuided(
            await readJsonBody(request) as InstallerProfilePayload,
          );
          if (!response.ok) {
            return json(response, {
              status: launchFailureStatus(response, 500),
            });
          }

          return json(response, {
            status: 202,
          });
        }

        if (url.pathname === INSTALLER_ROUTES.startClassic) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const response = await deps.launchClassic();
          if (!response.ok) {
            return json(response, {
              status: launchFailureStatus(response, 500),
            });
          }

          return json(response, {
            status: 202,
          });
        }

        return json(
          {
            ok: false,
            message: "Ruta no encontrada.",
          },
          {
            status: 404,
          },
        );
      } catch (error) {
        if (error instanceof HttpError) {
          return json(
            {
              ok: false,
              message: error.message,
            },
            {
              status: error.status,
            },
          );
        }

        return json(
          {
            ok: false,
            message: error instanceof Error ? error.message : "Error interno del servidor.",
          },
          {
            status: 500,
          },
        );
      }
    },
  };
}

export function startInstallerApiServer(
  dependencies: Partial<InstallerApiDependencies> = {},
  options: {
    hostname?: string;
    port?: number;
  } = {},
): Bun.Server<unknown> {
  const handler = createInstallerApiHandler(dependencies);
  const server = Bun.serve({
    hostname: options.hostname ?? INSTALLER_API_HOST,
    port: options.port ?? INSTALLER_API_PORT,
    fetch: handler.fetch,
  });

  console.log(`[agenos-installer-api] listening on http://${server.hostname}:${server.port}`);
  return server;
}

export async function runInstallerApiServer(
  dependencies: Partial<InstallerApiDependencies> = {},
  options: {
    hostname?: string;
    port?: number;
  } = {},
): Promise<void> {
  const server = startInstallerApiServer(dependencies, options);

  await new Promise<void>((resolve) => {
    const stop = () => {
      server.stop(true);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

if (import.meta.main) {
  void runInstallerApiServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
