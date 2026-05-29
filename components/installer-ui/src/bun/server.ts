import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

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
import { createAppTool } from "./agent/apps";
import { createBrowserTool } from "./agent/browser";
import { runShellCommand } from "../../../agent/shell";
import { createAgentAdminService } from "./agent/admin";
import { createConfirmationStore } from "./agent/confirmations";
import { createMemoryStore } from "./agent/memory";
import { decidePolicy } from "./agent/policy";
import { createOpenClawSetupService } from "./agent/setup";
import { createTaskQueue } from "./agent/tasks";
import { createToolRunner } from "./agent/tool-runner";
import { createLocalWorkerAuth } from "./agent/worker/local-auth";
import { createSupportBundle } from "./diagnostics/support-bundle";
import { switchMode } from "../shared/system-services/switch-mode";
import { HttpError, json, methodNotAllowed, options, readJsonBody } from "./http";
import { discoverDisks } from "./installer/disks";
import { launchClassic, launchGuided } from "./installer/launch";
import { readPreflightPayload } from "./installer/preflight";
import { isMaintenanceAction, isShellMode } from "./installer/runtime";
import { validateProfile } from "./installer/validate-profile";
import { runMaintenance } from "./system/maintenance";
import { createPiHarness, PiHarnessError, PI_PROVIDER_NAME } from "./pi-harness";
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
  cancelAuth(attemptId?: string): PiAuthAttemptResponse | null;
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
  createPiHarness?: () => PiHarnessApi;
  memoryStore: ReturnType<typeof createMemoryStore>;
  taskQueue: ReturnType<typeof createTaskQueue>;
  appTool: ReturnType<typeof createAppTool>;
  browserTool: ReturnType<typeof createBrowserTool>;
  shellTool: typeof runShellCommand;
  toolRunner: ReturnType<typeof createToolRunner>;
  workerAuth: ReturnType<typeof createLocalWorkerAuth>;
  confirmations: ReturnType<typeof createConfirmationStore>;
  agentAdmin: ReturnType<typeof createAgentAdminService>;
  setup: ReturnType<typeof createOpenClawSetupService>;
  supportBundle: () => Promise<unknown>;
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

function piHarnessUnavailable(error: unknown): PiHarnessError {
  const message = error instanceof Error ? error.message : String(error);
  return new PiHarnessError(503, message);
}

function createResilientPiHarness(factory: () => PiHarnessApi): PiHarnessApi {
  let harness: PiHarnessApi | undefined;

  const getHarness = () => {
    if (harness) {
      return harness;
    }

    try {
      harness = factory();
      return harness;
    } catch (error) {
      throw piHarnessUnavailable(error);
    }
  };

  return {
    getStatus() {
      try {
        return getHarness().getStatus();
      } catch (error) {
        const unavailable = piHarnessUnavailable(error);
        return {
          authState: "error",
          providerName: PI_PROVIDER_NAME,
          modelId: "unavailable",
          busy: false,
          error: unavailable.message,
        };
      }
    },
    startAuth() {
      return getHarness().startAuth();
    },
    cancelAuth(attemptId?: string) {
      return getHarness().cancelAuth(attemptId);
    },
    getAuthAttempt(attemptId: string) {
      return getHarness().getAuthAttempt(attemptId);
    },
    submitManualCode(attemptId: string, input: string) {
      return getHarness().submitManualCode(attemptId, input);
    },
    logout() {
      return getHarness().logout();
    },
    chat(request: PiChatRequest) {
      return getHarness().chat(request);
    },
  };
}

export function createInstallerApiHandler(
  dependencies: Partial<InstallerApiDependencies> = {},
): { fetch: (request: Request) => Promise<Response> } {
  const confirmations = dependencies.confirmations ?? createConfirmationStore();
  const memoryStore = dependencies.memoryStore ?? createMemoryStore();
  const taskQueue = dependencies.taskQueue ?? createTaskQueue();
  const setup = dependencies.setup ?? createOpenClawSetupService();
  const agentAdmin = dependencies.agentAdmin ?? createAgentAdminService({
    worker: taskQueue,
    taskQueue,
    memoryStore,
    confirmations,
    setup,
  });
  const supportBundle = dependencies.supportBundle ?? (() => createSupportBundle({ agentAdmin }));
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
    piHarness: dependencies.piHarness ?? createResilientPiHarness(() => (dependencies.createPiHarness ?? createPiHarness)({ setupService: setup })),
    memoryStore,
    taskQueue,
    appTool: dependencies.appTool ?? createAppTool(),
    browserTool: dependencies.browserTool ?? createBrowserTool(),
    shellTool: dependencies.shellTool ?? runShellCommand,
    confirmations,
    agentAdmin,
    setup,
    supportBundle,
    toolRunner: dependencies.toolRunner ?? createToolRunner({ confirmations, memoryStore, shellTool: dependencies.shellTool ?? runShellCommand }),
    workerAuth: dependencies.workerAuth ?? createLocalWorkerAuth({
      tokenPath: join(homedir(), ".agenos", "broker", "worker-token"),
    }),
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

        if (url.pathname === "/api/diagnostics/support-bundle") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          return json(await deps.supportBundle());
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

        if (url.pathname === "/api/pi/auth/cancel") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          try {
            const payload = await readJsonBody(request) as { attemptId?: unknown };
            deps.piHarness.cancelAuth(typeof payload.attemptId === "string" ? payload.attemptId : undefined);
            return json({ ok: true });
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

        if (url.pathname === "/api/agent/memory/events") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          const limit = Number(url.searchParams.get("limit") ?? "50");
          return json(deps.memoryStore.events(Number.isFinite(limit) ? limit : 50));
        }

        if (url.pathname === "/api/agent/admin/status") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(await deps.agentAdmin.status());
        }

        if (url.pathname === "/api/agent/setup/status") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(await deps.setup.status());
        }

        if (url.pathname === "/api/agent/setup/run") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return json(await deps.setup.run(), { status: 202 });
        }

        if (url.pathname === "/api/agent/auth/codex/start") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return json(await deps.setup.startCodexLogin(), { status: 202 });
        }

        if (url.pathname === "/api/agent/channels/telegram/configure") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { token?: unknown };
          if (typeof payload.token !== "string" || !payload.token.trim()) {
            return json({ ok: false, message: "Telegram bot token is required." }, { status: 400 });
          }
          return json(await deps.setup.configureTelegram(payload.token), { status: 202 });
        }

        if (url.pathname === "/api/agent/channels/telegram/test") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return json(await deps.setup.testTelegram(), { status: 202 });
        }

        if (url.pathname === "/api/agent/channels/telegram/enable") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return json(await deps.setup.enableTelegram(), { status: 202 });
        }

        if (url.pathname === "/api/agent/admin/config") {
          if (request.method === "GET") {
            return json(await deps.agentAdmin.readConfig());
          }
          if (request.method === "POST") {
            const payload = await readJsonBody(request) as Record<string, unknown>;
            const response = await deps.agentAdmin.writeConfig(payload, "ui");
            return json(response, { status: response.decision === "confirm" ? 409 : 202 });
          }
          return methodNotAllowed(["GET", "POST", "OPTIONS"]);
        }

        if (url.pathname === "/api/agent/admin/policy") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(deps.agentAdmin.readPolicy());
        }

        if (url.pathname === "/api/agent/admin/restart") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const response = await deps.agentAdmin.restart("ui");
          return json(response, { status: response.decision === "confirm" ? 409 : 202 });
        }

        if (url.pathname === "/api/agent/admin/test-connection") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const response = await deps.agentAdmin.testConnection("ui");
          return json(response, { status: response.status });
        }

        if (url.pathname === "/api/agent/admin/export-diagnostics") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return json(await deps.agentAdmin.exportDiagnostics("ui"));
        }

        const adminTaskActionMatch = url.pathname.match(/^\/api\/agent\/admin\/tasks\/([^/]+)\/(retry|clear)$/);
        if (adminTaskActionMatch) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const taskId = decodeURIComponent(adminTaskActionMatch[1] ?? "");
          const action = adminTaskActionMatch[2];
          const response = action === "retry"
            ? await deps.agentAdmin.retryTask(taskId, "ui")
            : await deps.agentAdmin.clearTask(taskId, "ui");
          return json(response, { status: "decision" in response && response.decision === "confirm" ? 409 : 202 });
        }

        const memoryMatch = url.pathname.match(/^\/api\/agent\/memory\/([^/]+)$/);
        if (memoryMatch) {
          const namespace = decodeURIComponent(memoryMatch[1] ?? "");
          if (namespace !== "contacts" && namespace !== "preferences" && namespace !== "facts") {
            return json({ ok: false, message: "Namespace de memoria invalido." }, { status: 400 });
          }

          if (request.method === "GET") {
            return json(deps.memoryStore.read(namespace));
          }

          if (request.method === "POST") {
            const payload = await readJsonBody(request) as {
              content?: unknown;
              source?: unknown;
              explicitUserIntent?: unknown;
            };
            const source = payload.source === "openclaw" || payload.source === "system" ? payload.source : "ui";
            const policy = decidePolicy({
              tool: "memory.write",
              source,
              explicitUserIntent: payload.explicitUserIntent === true,
            });
            if (policy.decision === "deny") {
              return json({ ok: false, decision: "deny", ruleId: policy.ruleId, message: policy.reason }, { status: 403 });
            }
            if (policy.decision === "confirm") {
              const result = await deps.toolRunner.run({
                source,
                tool: "memory.write",
                input: {
                  namespace,
                  content: typeof payload.content === "string" ? payload.content : "",
                },
              });
              return json({
                ok: false,
                decision: "confirm",
                ruleId: policy.ruleId,
                confirmationId: result.confirmationId,
                message: policy.reason,
              }, { status: 409 });
            }

            const response = deps.memoryStore.append(
              namespace,
              typeof payload.content === "string" ? payload.content : "",
              source,
            );
            return json(response, { status: response.ok ? 202 : 400 });
          }

          return methodNotAllowed(["GET", "POST", "OPTIONS"]);
        }

        if (url.pathname === "/api/agent/worker/health") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(await deps.taskQueue.health());
        }

        if (url.pathname === "/api/agent/confirmations") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(deps.confirmations.list());
        }

        const confirmationActionMatch = url.pathname.match(/^\/api\/agent\/confirmations\/([^/]+)\/(confirm|deny)$/);
        if (confirmationActionMatch) {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const confirmationId = decodeURIComponent(confirmationActionMatch[1] ?? "");
          const action = confirmationActionMatch[2];
          const record = action === "confirm"
            ? deps.confirmations.confirm(confirmationId, "ui")
            : deps.confirmations.deny(confirmationId, "ui");
          if (!record) {
            return json({ ok: false, message: "Confirmacion no encontrada." }, { status: 404 });
          }

          if (record.status === "confirmed" && record.tool === "memory.write") {
            const input = record.input as { namespace?: unknown; content?: unknown };
            const namespace = input.namespace;
            if (namespace === "contacts" || namespace === "preferences" || namespace === "facts") {
              deps.memoryStore.append(namespace, typeof input.content === "string" ? input.content : "", {
                source: record.source,
                taskId: record.taskId,
                correlationId: record.correlationId,
                confirmationId: record.confirmationId,
              });
            }
          }

          return json({ ok: true, confirmation: record }, { status: 202 });
        }

        const confirmationMatch = url.pathname.match(/^\/api\/agent\/confirmations\/([^/]+)$/);
        if (confirmationMatch) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          const record = deps.confirmations.get(decodeURIComponent(confirmationMatch[1] ?? ""));
          if (!record) {
            return json({ ok: false, message: "Confirmacion no encontrada." }, { status: 404 });
          }
          return json(record);
        }

        if (url.pathname === "/api/agent/tasks") {
          if (request.method === "GET") {
            const limit = Number(url.searchParams.get("limit") ?? "50");
            return json(await deps.taskQueue.list(Number.isFinite(limit) ? limit : 50));
          }

          if (request.method !== "POST") {
            return methodNotAllowed(["GET", "POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { message?: unknown; source?: unknown };
          const policy = decidePolicy({ tool: "tasks.enqueue", source: "ui" });
          if (policy.decision !== "allow") {
            return json({ ok: false, message: policy.reason }, { status: 403 });
          }
          const response = await deps.taskQueue.enqueue({
            message: typeof payload.message === "string" ? payload.message : "",
            source: payload.source === "openclaw" || payload.source === "system" ? payload.source : "ui",
          });
          return json(response, { status: response.ok ? 202 : 400 });
        }

        const taskEventsMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)\/events$/);
        if (taskEventsMatch) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          return json(await deps.taskQueue.events(decodeURIComponent(taskEventsMatch[1] ?? "")));
        }

        const taskStatusMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)$/);
        if (taskStatusMatch) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          const task = await deps.taskQueue.status(decodeURIComponent(taskStatusMatch[1] ?? ""));
          if (!task) {
            return json({ ok: false, message: "Tarea no encontrada." }, { status: 404 });
          }
          return json(task);
        }

        if (url.pathname === "/api/agent/worker/tool-call") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const auth = deps.workerAuth.authorizeWorkerRequest(request);
          if (auth.ok === false) {
            return json({ ok: false, message: auth.message }, { status: auth.status });
          }

          const payload = await readJsonBody(request) as {
            source?: unknown;
            taskId?: unknown;
            correlationId?: unknown;
            tool?: unknown;
            input?: unknown;
          };
          const result = await deps.toolRunner.run({
            source: payload.source === "system" ? "system" : "openclaw",
            taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
            correlationId: typeof payload.correlationId === "string" ? payload.correlationId : undefined,
            tool: typeof payload.tool === "string" ? payload.tool : "",
            input: payload.input,
          });

          const status = result.decision === "deny" ? 403 : result.decision === "confirm" ? 409 : 202;
          return json(result, { status });
        }

        if (url.pathname === "/api/agent/browser/open-url") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { url?: unknown };
          const policy = decidePolicy({ tool: "browser.open_url", source: "ui" });
          if (policy.decision !== "allow") {
            return json({ ok: false, message: policy.reason }, { status: 403 });
          }

          const response = await deps.browserTool.openUrl(typeof payload.url === "string" ? payload.url : "");
          return json(response, { status: response.ok ? 202 : 400 });
        }

        if (url.pathname === "/api/agent/shell/exec") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { command?: unknown; cwd?: unknown; timeoutMs?: unknown };
          const policy = decidePolicy({ tool: "shell.exec", source: "ui", explicitUserIntent: true });
          if (policy.decision !== "allow") {
            return json({ ok: false, decision: policy.decision, ruleId: policy.ruleId, message: policy.reason }, {
              status: policy.decision === "deny" ? 403 : 409,
            });
          }

          const response = await deps.shellTool({
            command: typeof payload.command === "string" ? payload.command : "",
            cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
            timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
          });
          return json(response, { status: response.ok ? 202 : 400 });
        }

        if (url.pathname === "/api/agent/apps/open") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { app?: unknown };
          const policy = decidePolicy({ tool: "apps.open", source: "ui" });
          if (policy.decision !== "allow") {
            return json({ ok: false, message: policy.reason }, { status: 403 });
          }

          const response = await deps.appTool.openApp(typeof payload.app === "string" ? payload.app : "");
          return json(response, { status: response.ok ? 202 : 400 });
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
