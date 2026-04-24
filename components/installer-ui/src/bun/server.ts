import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

import type {
  ApiMessageResponse,
  DiskSummary,
  InstallerProfilePayload,
  LaunchResponse,
  MaintenanceAction,
  PreflightResponse,
  ShellMode,
  SwitchModeRequest,
  ValidationResponse,
} from "../shared/installer-types";
import {
  INSTALLER_API_HOST,
  INSTALLER_API_PORT,
  INSTALLER_ROUTES,
} from "../shared/installer-http";
import { switchMode } from "../shared/system-services/switch-mode";
import { HttpError, json, methodNotAllowed, options, readJsonBody } from "./http";
import { discoverDisks } from "./installer/disks";
import { launchClassic, launchGuided } from "./installer/launch";
import { readPreflightPayload } from "./installer/preflight";
import { isMaintenanceAction, isShellMode } from "./installer/runtime";
import { validateProfile } from "./installer/validate-profile";
import { runMaintenance } from "./system/maintenance";
import { createPiHarness, PiHarnessError } from "./pi-harness";
import type {
  PiAuthAttemptResponse,
  PiChatRequest,
  PiChatResponse,
  PiPendingAttempt,
  PiStatusResponse,
} from "../../../ui/src/lib/pi-types";

type PiHarnessApi = {
  getStatus(): PiStatusResponse;
  startAuth(): Promise<PiPendingAttempt>;
  getAuthAttempt(attemptId: string): PiAuthAttemptResponse;
  submitManualCode(attemptId: string, input: string): PiAuthAttemptResponse;
  logout(): void;
  chat(request: PiChatRequest): Promise<PiChatResponse>;
};

export type InstallerApiDependencies = {
  installerFrontendDistDir: string | null;
  systemFrontendDistDir: string | null;
  getPreflight: () => PreflightResponse;
  getDisks: () => DiskSummary[];
  validateProfile: (payload: unknown) => ValidationResponse;
  launchGuided: (profile: InstallerProfilePayload) => Promise<LaunchResponse>;
  launchClassic: () => Promise<LaunchResponse>;
  switchMode: (mode: ShellMode) => Promise<ApiMessageResponse>;
  runMaintenance: (action: MaintenanceAction) => Promise<ApiMessageResponse>;
  piHarness: PiHarnessApi;
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

function isPathInside(rootDir: string, candidate: string): boolean {
  return candidate === rootDir || candidate.startsWith(`${rootDir}/`);
}

function resolveFrontendPath(frontendDistDir: string, pathname: string): string {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\/+/, ""));
  return resolve(frontendDistDir, relativePath);
}

function stripPrefix(pathname: string, prefix: string): string | null {
  if (prefix === "/") {
    return pathname;
  }

  if (pathname === prefix || pathname === `${prefix}/`) {
    return "/";
  }

  if (!pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  return pathname.slice(prefix.length) || "/";
}

function frontendResponseForPrefix(
  request: Request,
  pathname: string,
  frontendDistDir: string | null,
  prefix: string,
): Response | null {
  if (request.method !== "GET" || !frontendDistDir) {
    return null;
  }

  if (pathname === INSTALLER_ROUTES.health || pathname.startsWith("/api/")) {
    return null;
  }

  const relativePathname = stripPrefix(pathname, prefix);
  if (relativePathname === null) {
    return null;
  }

  const rootDir = resolve(frontendDistDir);
  const requestedFile = resolveFrontendPath(rootDir, relativePathname);
  if (!isPathInside(rootDir, requestedFile)) {
    return new Response("Ruta no válida.", { status: 400 });
  }

  if (existsSync(requestedFile)) {
    return new Response(Bun.file(requestedFile));
  }

  if (extname(relativePathname)) {
    return null;
  }

  const indexFile = resolve(rootDir, "index.html");
  if (!existsSync(indexFile)) {
    return null;
  }

  return new Response(Bun.file(indexFile));
}

function frontendResponse(
  request: Request,
  url: URL,
  frontend: {
    installerFrontendDistDir: string | null;
    systemFrontendDistDir: string | null;
  },
): Response | null {
  if (request.method === "GET" && url.pathname === "/installer") {
    return Response.redirect(new URL("/installer/", url).toString(), 308);
  }

  if (url.pathname.startsWith("/installer")) {
    return frontendResponseForPrefix(
      request,
      url.pathname,
      frontend.installerFrontendDistDir,
      "/installer",
    );
  }

  return frontendResponseForPrefix(
    request,
    url.pathname,
    frontend.systemFrontendDistDir,
    "/",
  );
}

function piErrorResponse(error: unknown): Response {
  const status = error instanceof PiHarnessError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Error del harness de desarrollo.";

  return json(
    {
      ok: false,
      message,
    },
    {
      status,
    },
  );
}

export function createInstallerApiHandler(
  dependencies: Partial<InstallerApiDependencies> = {},
): { fetch: (request: Request) => Promise<Response> } {
  const deps: InstallerApiDependencies = {
    installerFrontendDistDir: dependencies.installerFrontendDistDir ?? resolve(import.meta.dir, "..", "dist"),
    systemFrontendDistDir: dependencies.systemFrontendDistDir ?? resolve(import.meta.dir, "..", "system-dist"),
    getPreflight: dependencies.getPreflight ?? readPreflightPayload,
    getDisks: dependencies.getDisks ?? discoverDisks,
    validateProfile: dependencies.validateProfile ?? defaultValidationResponse,
    launchGuided: dependencies.launchGuided ?? launchGuided,
    launchClassic: dependencies.launchClassic ?? launchClassic,
    switchMode: dependencies.switchMode ?? switchMode,
    runMaintenance: dependencies.runMaintenance ?? runMaintenance,
    piHarness: dependencies.piHarness ?? createPiHarness(),
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

        if (url.pathname === INSTALLER_ROUTES.switchMode) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const payload = await readJsonBody(request) as Partial<SwitchModeRequest>;
          if (!isShellMode(payload.mode)) {
            return json(
              {
                ok: false,
                message: "El modo debe ser installer o system.",
              },
              {
                status: 400,
              },
            );
          }

          const response = await deps.switchMode(payload.mode);
          if (!response.ok) {
            return json(response, {
              status: 500,
            });
          }

          return json(response, {
            status: 202,
          });
        }

        if (url.pathname === INSTALLER_ROUTES.systemMaintenance) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const payload = await readJsonBody(request) as { action?: unknown };
          if (!isMaintenanceAction(payload.action)) {
            return json(
              {
                ok: false,
                message: "La acción debe ser terminal.",
              },
              {
                status: 400,
              },
            );
          }

          const response = await deps.runMaintenance(payload.action);
          if (!response.ok) {
            return json(response, {
              status: 500,
            });
          }

          return json(response, {
            status: 202,
          });
        }

        if (url.pathname === "/api/pi/status") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          try {
            return json(deps.piHarness.getStatus());
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        if (url.pathname === "/api/pi/auth/start") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          try {
            return json(await deps.piHarness.startAuth());
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        const authAttemptMatch = url.pathname.match(/^\/api\/pi\/auth\/attempt\/([^/]+)$/);
        if (authAttemptMatch) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          try {
            return json(deps.piHarness.getAuthAttempt(decodeURIComponent(authAttemptMatch[1] ?? "")));
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        const manualCodeMatch = url.pathname.match(/^\/api\/pi\/auth\/attempt\/([^/]+)\/manual-code$/);
        if (manualCodeMatch) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          try {
            const payload = await readJsonBody(request) as { input?: unknown };
            return json(
              deps.piHarness.submitManualCode(
                decodeURIComponent(manualCodeMatch[1] ?? ""),
                typeof payload.input === "string" ? payload.input : "",
              ),
              {
                status: 202,
              },
            );
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        if (url.pathname === "/api/pi/auth/logout") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          try {
            deps.piHarness.logout();
            return json({ ok: true });
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        if (url.pathname === "/api/pi/chat") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          try {
            const payload = await readJsonBody(request) as { message?: unknown; source?: unknown };
            const source = typeof payload.source === "string" ? payload.source : "";
            if (source !== "text" && source !== "voice") {
              return json(
                {
                  ok: false,
                  message: "El origen debe ser text o voice.",
                },
                {
                  status: 400,
                },
              );
            }

            return json(await deps.piHarness.chat({
              message: typeof payload.message === "string" ? payload.message : "",
              source,
            }));
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        const frontend = frontendResponse(request, url, {
          installerFrontendDistDir: deps.installerFrontendDistDir,
          systemFrontendDistDir: deps.systemFrontendDistDir,
        });
        if (frontend) {
          return frontend;
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
