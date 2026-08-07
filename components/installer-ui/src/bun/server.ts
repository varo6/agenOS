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
import { createWorkspaceService } from "./agent/workspaces";
import { runShellCommand } from "../../../agent/shell";
import { createFileTool } from "../../../agent/files";
import { createAgentAdminService } from "./agent/admin";
import { createConfirmationStore } from "./agent/confirmations";
import { createMemoryStore } from "./agent/memory";
import { createLearnedMemoryStore } from "./agent/learned-memory";
import { createSelfImprovementLoop } from "./agent/self-improvement";
import { decidePolicy } from "./agent/policy";
import { createOpenClawSetupService } from "./agent/setup";
import { createTaskQueue } from "./agent/tasks";
import { applyMemoryWrite, createToolRunner, type ToolRunResult } from "./agent/tool-runner";
import { createLocalWorkerAuth } from "./agent/worker/local-auth";
import { createLocalUiAuth } from "./agent/ui-auth";
import { createBrokerPiTools } from "./agent/broker-pi-tools";
import { createSupportBundle } from "./diagnostics/support-bundle";
import { createSttService, type SttService } from "./speech/stt";
import { switchMode } from "../shared/system-services/switch-mode";
import { HttpError, json, methodNotAllowed, options, readJsonBody, rejectUntrustedBrowserOrigin } from "./http";
import { discoverDisks } from "./installer/disks";
import { launchClassic, launchGuided } from "./installer/launch";
import { readPreflightPayload } from "./installer/preflight";
import { isMaintenanceAction, isShellMode } from "./installer/runtime";
import { validateProfile } from "./installer/validate-profile";
import { runMaintenance } from "./system/maintenance";
import { createPiHarness, PiHarnessError, PI_PROVIDER_NAME } from "../../../ui/dev/pi-harness";
import type { HarnessTraceRecord } from "../../../agent/harness-trace";
import type {
  PiAuthAttemptResponse,
  PiAuthMethod,
  PiChatRequest,
  PiChatResponse,
  PiPendingAttempt,
  PiStatusResponse,
  PiTurnState,
} from "../../../ui/src/lib/pi-types";
import { createNetworkManagerService, type NetworkManagerService } from "../../../network/node/network-manager";
import type { ConnectWifiRequest } from "../../../network/types";

type PiHarnessApi = {
  getStatus(): PiStatusResponse;
  startAuth(method?: PiAuthMethod): Promise<PiPendingAttempt>;
  cancelAuth(attemptId?: string): PiAuthAttemptResponse | null;
  getAuthAttempt(attemptId: string): PiAuthAttemptResponse;
  submitManualCode(attemptId: string, input: string): PiAuthAttemptResponse;
  logout(): void;
  chat(request: PiChatRequest): Promise<PiChatResponse>;
  startChat(request: PiChatRequest): PiTurnState;
  getTurn(turnId: string): PiTurnState;
  getLatestTurn(): PiTurnState | null;
  listTurns(limit?: number): PiTurnState[];
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
  learnedMemory: ReturnType<typeof createLearnedMemoryStore>;
  selfImprovement: ReturnType<typeof createSelfImprovementLoop>;
  taskQueue: ReturnType<typeof createTaskQueue>;
  appTool: ReturnType<typeof createAppTool>;
  browserTool: ReturnType<typeof createBrowserTool>;
  fileTool: ReturnType<typeof createFileTool>;
  workspaceService: ReturnType<typeof createWorkspaceService>;
  shellTool: typeof runShellCommand;
  toolRunner: ReturnType<typeof createToolRunner>;
  workerAuth: ReturnType<typeof createLocalWorkerAuth>;
  uiAuth: ReturnType<typeof createLocalUiAuth>;
  confirmations: ReturnType<typeof createConfirmationStore>;
  agentAdmin: ReturnType<typeof createAgentAdminService>;
  setup: ReturnType<typeof createOpenClawSetupService>;
  supportBundle: () => Promise<unknown>;
  network: NetworkManagerService;
  speech: SttService;
};

const MAX_SPEECH_AUDIO_BYTES = 25 * 1024 * 1024;

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

function isHarnessTracePayload(value: unknown): value is HarnessTraceRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const trace = value as Partial<HarnessTraceRecord>;
  return trace.schemaVersion === 1
    && trace.source === "pi-chat"
    && typeof trace.traceId === "string"
    && typeof trace.timestamp === "string"
    && (trace.status === "succeeded" || trace.status === "failed")
    && typeof trace.input?.text === "string"
    && Array.isArray(trace.toolEvents);
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

function toolRunResponse(result: ToolRunResult, successStatus = 202, failureStatus = 400): Response {
  if (result.decision !== "allow") {
    return json(result, { status: result.decision === "deny" ? 403 : 409 });
  }
  const payload = result.shell ?? result.output ?? result;
  return json(payload, { status: result.ok ? successStatus : failureStatus });
}

function isPathInside(rootDir: string, candidate: string): boolean {
  return candidate === rootDir || candidate.startsWith(`${rootDir}/`);
}

function connectWifiPayload(payload: unknown): ConnectWifiRequest {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    ssid: typeof body.ssid === "string" ? body.ssid : "",
    bssid: typeof body.bssid === "string" ? body.bssid : undefined,
    password: typeof body.password === "string" ? body.password : undefined,
    hidden: body.hidden === true,
    device: typeof body.device === "string" ? body.device : undefined,
  };
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
    startAuth(method?: PiAuthMethod) {
      return getHarness().startAuth(method);
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
    startChat(request: PiChatRequest) {
      return getHarness().startChat(request);
    },
    getTurn(turnId: string) {
      return getHarness().getTurn(turnId);
    },
    getLatestTurn() {
      return getHarness().getLatestTurn();
    },
    listTurns(limit?: number) {
      return getHarness().listTurns(limit);
    },
  };
}

export function createInstallerApiHandler(
  dependencies: Partial<InstallerApiDependencies> = {},
): { fetch: (request: Request) => Promise<Response> } {
  const confirmations = dependencies.confirmations ?? createConfirmationStore();
  const memoryStore = dependencies.memoryStore ?? createMemoryStore();
  const learnedMemory = dependencies.learnedMemory ?? createLearnedMemoryStore();
  const shellTool = dependencies.shellTool ?? runShellCommand;
  const setup = dependencies.setup ?? createOpenClawSetupService();
  const appTool = dependencies.appTool ?? createAppTool();
  const browserTool = dependencies.browserTool ?? createBrowserTool();
  const fileTool = dependencies.fileTool ?? createFileTool();
  const workspaceService = dependencies.workspaceService ?? createWorkspaceService();
  const effectHandlers: NonNullable<Parameters<typeof createToolRunner>[0]["handlers"]> = {
    "apps.list": () => appTool.listApps(),
    "apps.open": (input) => appTool.openApp(input as never),
    "browser.open_url": (input) => browserTool.openUrl(
      input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string"
        ? (input as { url: string }).url
        : "",
    ),
    "files.open": (input) => fileTool.openPath(input as never),
    "workspaces.focus": (input) => workspaceService.focusWorkspace(input as never),
    "setup.status": () => setup.status(),
    "setup.run": () => setup.run(),
    "auth.codex.start": () => setup.startCodexLogin(),
    "telegram.configure": (input) => setup.configureTelegram(
      input && typeof input === "object" && typeof (input as { token?: unknown }).token === "string"
        ? (input as { token: string }).token
        : "",
    ),
    "telegram.test": () => setup.testTelegram(),
    "telegram.enable": () => setup.enableTelegram(),
    "memory.read": (input) => {
      const record = input && typeof input === "object" ? input as { action?: unknown; query?: unknown; tokenBudget?: unknown; includeDeleted?: unknown } : {};
      if (record.action === "context") {
        return learnedMemory.context(
          typeof record.query === "string" ? record.query : "",
          typeof record.tokenBudget === "number" ? record.tokenBudget : 256,
        );
      }
      return learnedMemory.list({ includeDeleted: record.includeDeleted === true });
    },
    "memory.delete": (input) => learnedMemory.delete(
      input && typeof input === "object" && typeof (input as { itemId?: unknown }).itemId === "string"
        ? (input as { itemId: string }).itemId
        : "",
    ),
  };
  const toolRunner = dependencies.toolRunner ?? createToolRunner({ confirmations, memoryStore, learnedMemory, shellTool, handlers: effectHandlers });
  const selfImprovement = dependencies.selfImprovement ?? createSelfImprovementLoop({
    memory: learnedMemory,
    listConfirmations: (limit) => confirmations.list(limit),
    proposeMemoryWrite: (input) => toolRunner.run({ source: "system", tool: "memory.write", input }),
  });
  const taskQueue = dependencies.taskQueue ?? createTaskQueue({
    learnedContextProvider: (query) => learnedMemory.context(query, 256).text,
    runToolCall: (call) => toolRunner.run({
      source: "system",
      taskId: call.taskId,
      correlationId: call.correlationId,
      tool: call.tool,
      input: call.input,
    }),
  });
  effectHandlers["tasks.enqueue"] = (input) => taskQueue.enqueue({
    message: input && typeof input === "object" && typeof (input as { message?: unknown }).message === "string"
      ? (input as { message: string }).message
      : "",
    source: "ui",
  });
  effectHandlers["tasks.read"] = async (input) => {
    const record = input && typeof input === "object" ? input as { action?: unknown; taskId?: unknown; limit?: unknown } : {};
    const taskId = typeof record.taskId === "string" ? record.taskId : "";
    if (record.action === "status") {
      const task = await taskQueue.status(taskId);
      if (task) {
        await selfImprovement.captureTask(task);
      }
      return task;
    }
    if (record.action === "events") {
      return taskQueue.events(taskId);
    }
    if (record.action === "list") {
      return taskQueue.list(typeof record.limit === "number" ? record.limit : undefined);
    }
    if (record.action === "health") {
      return taskQueue.health();
    }
    return null;
  };
  effectHandlers["memory.write"] = (input) => {
    const record = input && typeof input === "object" ? input as { action?: unknown; itemId?: unknown; statement?: unknown } : {};
    if (record.action !== "correct" || typeof record.itemId !== "string" || typeof record.statement !== "string") {
      return { ok: false, message: "Correccion de memoria invalida." };
    }
    return learnedMemory.update(record.itemId, { statement: record.statement });
  };
  const brokerPiTools = createBrokerPiTools({
    toolRunner,
    captureTrace: async (trace) => {
      await selfImprovement.captureHarnessTrace(trace);
    },
  });
  const agentAdmin = dependencies.agentAdmin ?? createAgentAdminService({
    worker: taskQueue,
    taskQueue,
    memoryStore,
    confirmations,
    setup,
  });
  const uiAuth = dependencies.uiAuth ?? createLocalUiAuth({
    tokenPath: process.env.AGENOS_UI_TOKEN_PATH?.trim()
      || join(homedir(), ".agenos", "broker", "ui-token"),
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
    piHarness: dependencies.piHarness ?? createResilientPiHarness(() => (dependencies.createPiHarness ?? createPiHarness)({
      setupService: setup,
      ...brokerPiTools,
    })),
    memoryStore,
    learnedMemory,
    selfImprovement,
    taskQueue,
    appTool,
    browserTool,
    fileTool,
    workspaceService,
    shellTool,
    confirmations,
    agentAdmin,
    setup,
    supportBundle,
    network: dependencies.network ?? createNetworkManagerService(),
    speech: dependencies.speech ?? createSttService(),
    toolRunner,
    workerAuth: dependencies.workerAuth ?? createLocalWorkerAuth({
      tokenPath: join(homedir(), ".agenos", "broker", "worker-token"),
    }),
    uiAuth,
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      try {
        if (url.pathname.startsWith("/api/")) {
          const rejectedOrigin = rejectUntrustedBrowserOrigin(request);
          if (rejectedOrigin) {
            return rejectedOrigin;
          }
        }

        if (request.method === "OPTIONS") {
          return options(["GET", "POST", "DELETE", "OPTIONS"]);
        }

        if (url.pathname.startsWith("/api/") && url.pathname !== "/api/agent/worker/tool-call") {
          const auth = deps.uiAuth.authorizeUiRequest(request);
          if (auth.ok === false) {
            return json({ ok: false, message: auth.message }, { status: auth.status });
          }
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

        if (url.pathname === "/api/network/status") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(await deps.network.getStatus());
        }

        if (url.pathname === "/api/network/wifi/scan") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return json(await deps.network.scanWifi(), { status: 202 });
        }

        if (url.pathname === "/api/network/wifi/access-points") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(await deps.network.listAccessPoints());
        }

        if (url.pathname === "/api/network/wifi/connect") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const response = await deps.network.connectWifi(connectWifiPayload(await readJsonBody(request)));
          return json(response, { status: response.ok ? 202 : 400 });
        }

        if (url.pathname === "/api/network/wifi/disconnect") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const response = await deps.network.disconnectWifi();
          return json(response, { status: response.ok ? 202 : 400 });
        }

        if (url.pathname === "/api/network/wifi/radio") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { enabled?: unknown };
          if (typeof payload.enabled !== "boolean") {
            return json({ ok: false, message: "enabled debe ser boolean." }, { status: 400 });
          }
          const response = await deps.network.setWifiEnabled(payload.enabled);
          return json(response, { status: response.ok ? 202 : 400 });
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
            const payload = await readJsonBody(request) as { method?: unknown };
            const method: PiAuthMethod = payload.method === "browser" ? "browser" : "device";
            return json(await deps.piHarness.startAuth(method));
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

        if (url.pathname === "/api/pi/turns") {
          if (request.method === "GET") {
            try {
              const limit = Number(url.searchParams.get("limit") ?? "20");
              return json(deps.piHarness.listTurns(Number.isFinite(limit) ? limit : undefined));
            } catch (error) {
              return piErrorResponse(error);
            }
          }

          if (request.method !== "POST") {
            return methodNotAllowed(["GET", "POST", "OPTIONS"]);
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

            return json(deps.piHarness.startChat({
              message: typeof payload.message === "string" ? payload.message : "",
              source,
            }), { status: 202 });
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        if (url.pathname === "/api/pi/turns/latest") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          try {
            return json(deps.piHarness.getLatestTurn());
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        const turnMatch = url.pathname.match(/^\/api\/pi\/turns\/([^/]+)$/);
        if (turnMatch) {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          try {
            return json(deps.piHarness.getTurn(decodeURIComponent(turnMatch[1] ?? "")));
          } catch (error) {
            return piErrorResponse(error);
          }
        }

        if (url.pathname === "/api/speech/status") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(deps.speech.status());
        }

        if (url.pathname === "/api/speech/transcribe") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }

          const audio = new Uint8Array(await request.arrayBuffer());
          if (audio.byteLength === 0) {
            return json({ ok: false, message: "El body debe contener audio." }, { status: 400 });
          }
          if (audio.byteLength > MAX_SPEECH_AUDIO_BYTES) {
            return json({ ok: false, message: "El audio supera el tamano maximo permitido." }, { status: 413 });
          }

          const result = await deps.speech.transcribe({
            audio,
            contentType: request.headers.get("content-type") ?? "",
            lang: url.searchParams.get("lang") ?? undefined,
          });

          if (result.ok === false) {
            const speechStatus = result.code === "unavailable" ? 503 : result.code === "unsupported-media" ? 400 : 500;
            return json(result, { status: speechStatus });
          }

          return json(result);
        }

        if (url.pathname === "/api/agent/memory/events") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          const limit = Number(url.searchParams.get("limit") ?? "50");
          return json(deps.memoryStore.events(Number.isFinite(limit) ? limit : 50));
        }

        if (url.pathname === "/api/agent/learning/memories") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          return json(deps.learnedMemory.list({ includeDeleted: url.searchParams.get("includeDeleted") === "true" }));
        }

        if (url.pathname === "/api/agent/learning/signals") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          const limit = Number(url.searchParams.get("limit") ?? "100");
          return json(deps.learnedMemory.signals(Number.isFinite(limit) ? limit : 100));
        }

        if (url.pathname === "/api/agent/learning/context") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }
          const tokenBudget = Number(url.searchParams.get("tokenBudget") ?? "256");
          return json(deps.learnedMemory.context(
            url.searchParams.get("query") ?? "",
            Number.isFinite(tokenBudget) ? tokenBudget : 256,
          ));
        }

        if (url.pathname === "/api/agent/learning/signals/harness") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request);
          if (!isHarnessTracePayload(payload)) {
            return json({ ok: false, message: "Traza de harness invalida." }, { status: 400 });
          }
          const captured = await deps.selfImprovement.captureHarnessTrace(payload);
          return json({
            ok: true,
            signalIds: captured.signals.map((signal) => signal.signalId),
            proposals: captured.proposals.length,
          }, { status: 202 });
        }

        const learnedMemoryMatch = url.pathname.match(/^\/api\/agent\/learning\/memories\/([^/]+)$/);
        if (learnedMemoryMatch) {
          const itemId = decodeURIComponent(learnedMemoryMatch[1] ?? "");
          if (request.method === "POST") {
            const payload = await readJsonBody(request) as { statement?: unknown; explicitUserIntent?: unknown };
            if (payload.explicitUserIntent !== true) {
              return json({ ok: false, message: "La correccion requiere intencion explicita del usuario." }, { status: 403 });
            }
            const policy = decidePolicy({ tool: "memory.write", source: "ui", explicitUserIntent: payload.explicitUserIntent === true });
            if (policy.decision !== "allow") {
              return json({ ok: false, decision: policy.decision, ruleId: policy.ruleId, message: policy.reason }, { status: policy.decision === "deny" ? 403 : 409 });
            }
            if (typeof payload.statement !== "string" || !payload.statement.trim()) {
              return json({ ok: false, message: "La correccion no puede estar vacia." }, { status: 400 });
            }
            const item = deps.learnedMemory.update(itemId, { statement: payload.statement });
            return item ? json(item, { status: 202 }) : json({ ok: false, message: "Memoria aprendida no encontrada." }, { status: 404 });
          }
          if (request.method === "DELETE") {
            const payload = await readJsonBody(request) as { explicitUserIntent?: unknown };
            if (payload.explicitUserIntent !== true) {
              return json({ ok: false, message: "Olvidar memoria requiere intencion explicita del usuario." }, { status: 403 });
            }
            const policy = decidePolicy({ tool: "memory.delete", source: "ui", explicitUserIntent: payload.explicitUserIntent === true });
            if (policy.decision !== "allow") {
              return json({ ok: false, decision: policy.decision, ruleId: policy.ruleId, message: policy.reason }, { status: 403 });
            }
            const item = deps.learnedMemory.delete(itemId);
            return item ? json(item, { status: 202 }) : json({ ok: false, message: "Memoria aprendida no encontrada." }, { status: 404 });
          }
          return methodNotAllowed(["POST", "DELETE", "OPTIONS"]);
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
          return toolRunResponse(await deps.toolRunner.run({ source: "ui", tool: "setup.status", input: {} }), 200, 200);
        }

        if (url.pathname === "/api/agent/setup/run") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return toolRunResponse(await deps.toolRunner.run({ source: "ui", tool: "setup.run", input: {} }), 202, 202);
        }

        if (url.pathname === "/api/agent/auth/codex/start") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return toolRunResponse(await deps.toolRunner.run({ source: "ui", tool: "auth.codex.start", input: {} }), 202, 202);
        }

        if (url.pathname === "/api/agent/channels/telegram/configure") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { token?: unknown };
          if (typeof payload.token !== "string" || !payload.token.trim()) {
            return json({ ok: false, message: "Telegram bot token is required." }, { status: 400 });
          }
          return toolRunResponse(await deps.toolRunner.run({ source: "ui", tool: "telegram.configure", input: { token: payload.token } }), 202, 202);
        }

        if (url.pathname === "/api/agent/channels/telegram/test") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return toolRunResponse(await deps.toolRunner.run({ source: "ui", tool: "telegram.test", input: {} }), 202, 202);
        }

        if (url.pathname === "/api/agent/channels/telegram/enable") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          return toolRunResponse(await deps.toolRunner.run({ source: "ui", tool: "telegram.enable", input: {} }), 202, 202);
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
          if (action === "retry") {
            await deps.selfImprovement.captureRetry(taskId);
          }
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
            const source = "ui" as const;
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
            applyMemoryWrite({ memoryStore: deps.memoryStore, learnedMemory: deps.learnedMemory }, record.input, {
              source: record.source,
              taskId: record.taskId,
              correlationId: record.correlationId,
              confirmationId: record.confirmationId,
            });
          }
          if (record.status === "denied") {
            await deps.selfImprovement.captureDenied(record);
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
          const payload = await readJsonBody(request) as { message?: unknown };
          return toolRunResponse(await deps.toolRunner.run({
            source: "ui",
            tool: "tasks.enqueue",
            input: { message: typeof payload.message === "string" ? payload.message : "" },
          }));
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
          await deps.selfImprovement.captureTask(task);
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
          return toolRunResponse(await deps.toolRunner.run({
            source: "ui",
            tool: "browser.open_url",
            input: { url: typeof payload.url === "string" ? payload.url : "" },
          }));
        }

        if (url.pathname === "/api/agent/shell/exec") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { command?: unknown; cwd?: unknown; timeoutMs?: unknown };
          return toolRunResponse(await deps.toolRunner.run({
            source: "ui",
            tool: "shell.exec",
            explicitUserIntent: true,
            input: {
            command: typeof payload.command === "string" ? payload.command : "",
            cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
            timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
            },
          }));
        }

        if (url.pathname === "/api/agent/files/open") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { path?: unknown; workspace?: unknown; focus?: unknown };
          return toolRunResponse(await deps.toolRunner.run({
            source: "ui",
            tool: "files.open",
            input: {
              path: typeof payload.path === "string" ? payload.path : "",
              workspace: payload.workspace,
              focus: payload.focus !== false,
            },
          }));
        }

        if (url.pathname === "/api/agent/workspaces") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          return json(deps.workspaceService.listWorkspaces());
        }

        if (url.pathname === "/api/agent/workspaces/events") {
          if (request.method !== "GET") {
            return methodNotAllowed(["GET", "OPTIONS"]);
          }

          const encoder = new TextEncoder();
          let unsubscribe = () => {};
          let stopped = false;
          const stop = () => {
            if (stopped) {
              return;
            }
            stopped = true;
            unsubscribe();
          };
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              unsubscribe = deps.workspaceService.subscribeWorkspaceChanges((state) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
              });
              request.signal.addEventListener("abort", stop, { once: true });
              if (request.signal.aborted) {
                stop();
              }
            },
            cancel: stop,
          });

          return new Response(stream, {
            headers: {
              "Cache-Control": "no-cache",
              "Content-Type": "text/event-stream; charset=utf-8",
            },
          });
        }

        if (url.pathname === "/api/agent/workspaces/focus") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { workspace?: unknown };
          return toolRunResponse(await deps.toolRunner.run({
            source: "ui",
            tool: "workspaces.focus",
            input: { workspace: payload.workspace, source: "ui" },
          }));
        }

        if (url.pathname === "/api/agent/apps/open") {
          if (request.method !== "POST") {
            return methodNotAllowed(["POST", "OPTIONS"]);
          }
          const payload = await readJsonBody(request) as { app?: unknown; workspace?: unknown; focus?: unknown };
          return toolRunResponse(await deps.toolRunner.run({
            source: "ui",
            tool: "apps.open",
            input: {
              app: typeof payload.app === "string" ? payload.app : "",
              workspace: payload.workspace,
              focus: payload.focus !== false,
            },
          }));
        }

        const frontend = frontendResponse(request, url, {
          installerFrontendDistDir: deps.installerFrontendDistDir,
          systemFrontendDistDir: deps.systemFrontendDistDir,
        });
        if (frontend) {
          return deps.uiAuth.attachSession(frontend);
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
    // Pi chat turns hold the request open while the agent runs tools, so the
    // default 10s idle timeout would kill them mid-turn. 0 disables it.
    idleTimeout: 0,
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
