import { createAgentTaskModelTool, type AgentTaskClient } from "../../../../agent/agent-task-tool";
import { createOpenBrowserModelTool } from "../../../../agent/browser-open-tool";
import { createOpenFileModelTool } from "../../../../agent/file-open-tool";
import { createFilesContentModelTool } from "../../../../agent/files-content-tool";
import { createComputerRunModelTool, type ComputerRunOutcome } from "../../../../agent/computer-run-tool";
import { createWebControlModelTool } from "../../../../agent/web-control-tool";
import { createDesktopControlModelTool } from "../../../../agent/desktop-control-tool";
import { createGoogleModelTool, type GoogleToolServices } from "../../../../agent/google-tool";
import type { createFilesContentService } from "../../../../agent/files-content";
import { createPackageInstallModelTool, type PackageInstallToolService } from "../../../../agent/package-install-tool";
import {
  createLearningMemoryModelTool,
  type LearningMemoryClient,
} from "../../../../agent/learning-memory-tool";
import {
  createImprovementsModelTool,
  type ImprovementsClient,
} from "../../../../agent/improvements-tool";
import type { HarnessTraceRecord } from "../../../../agent/harness-trace";
import {
  createOpenAppModelTool,
  type PiCustomToolLike,
} from "../../../../ui/dev/pi-harness";
import { createOpenClawSetupModelTool, type OpenClawSetupToolService } from "./openclaw-setup-tool";
import type { createToolRunner, ToolRunResult } from "./tool-runner";
import type { createGoogleSendService } from "./google-send-service";

type ToolRunner = ReturnType<typeof createToolRunner>;

export type BrokerPiToolsOptions = {
  toolRunner: ToolRunner;
  googleSend: ReturnType<typeof createGoogleSendService>;
  packageService: PackageInstallToolService;
  captureTrace: (trace: HarnessTraceRecord) => Promise<void>;
};

function policyFailure(result: ToolRunResult): Error {
  const error = new Error(result.message ?? `El broker ${result.decision} la accion.`) as Error & {
    decision?: string;
    confirmationId?: string;
  };
  error.decision = result.decision;
  error.confirmationId = result.confirmationId;
  return error;
}

export function createBrokerPiTools(options: BrokerPiToolsOptions) {
  async function output<T>(tool: string, input: unknown, explicitUserIntent = false): Promise<T> {
    const result = await options.toolRunner.run({
      source: "ui",
      tool,
      input,
      explicitUserIntent,
    });
    if (result.decision !== "allow") {
      throw policyFailure(result);
    }
    return result.output as T;
  }

  const agentTaskClient: AgentTaskClient = {
    async enqueue(message) {
      const result = await options.toolRunner.run({ source: "ui", tool: "tasks.enqueue", input: { message } });
      return result.decision === "allow"
        ? result.output as Awaited<ReturnType<AgentTaskClient["enqueue"]>>
        : { ok: false, message: result.message };
    },
    status: (taskId) => output("tasks.read", { action: "status", taskId }),
    events: (taskId) => output("tasks.read", { action: "events", taskId }),
    list: (limit) => output("tasks.read", { action: "list", limit }),
    health: () => output("tasks.read", { action: "health" }),
  };

  const learningMemoryClient: LearningMemoryClient = {
    list: (includeDeleted) => output("memory.read", { action: "list", includeDeleted }),
    correct: (itemId, statement) => output("memory.write", { action: "correct", itemId, statement }, true),
    forget: (itemId) => output("memory.delete", { itemId }, true),
    context: (query, tokenBudget) => output("memory.read", { action: "context", query, tokenBudget }),
    captureTrace: options.captureTrace,
  };

  /*
   * Solo lectura. El modelo no puede crear ni borrar mejoras: las escribe el
   * destilador del broker cuando el usuario pulsa el boton, que es el unico
   * gesto que significa "esto me ha gustado".
   */
  const improvementsClient: ImprovementsClient = {
    catalog: (tokenBudget) => output("improvements.read", { action: "catalog", tokenBudget }),
    list: (category) => output("improvements.read", { action: "list", category }),
    search: (query, limit) => output("improvements.read", { action: "search", query, limit }),
    read: (name) => output("improvements.read", { action: "read", name }),
    forget: () => Promise.resolve(false),
  };

  // El servicio real vive en el backend; aqui solo se enrutan las llamadas por
  // el broker para que cada accion pase por su regla de politica (leer y listar
  // son libres, escribir se juzga por la ruta).
  const filesContentClient: ReturnType<typeof createFilesContentService> = {
    read: (path, options) => output("files.read", { path, maxBytes: options?.maxBytes }),
    write: (path, content) => output("files.write", { path, content, mode: "write" }, true),
    append: (path, content) => output("files.write", { path, content, mode: "append" }, true),
    list: (path) => output("files.list", { path }),
    search: (root, query, options) => output("files.search", { path: root, query, maxResults: options?.maxResults }),
  };

  // Todo lo que sigue son clientes finos: la implementacion real vive en el
  // backend y aqui solo se enruta por el broker para que cada accion pase por
  // su regla de politica y quede auditada.
  const computerRunService = {
    request: (input: { command: string; cwd?: string; timeoutMs?: number }) =>
      output<ComputerRunOutcome>("computer.run", { action: "request", ...input }, true),
    confirm: (confirmationId: string) =>
      output<ComputerRunOutcome>("computer.run", { action: "confirm", confirmationId }, true),
    deny: (confirmationId: string) =>
      output<ComputerRunOutcome>("computer.run", { action: "deny", confirmationId }, true),
  };

  const webController = {
    status: () => output("web.control", { action: "status" }),
    open: (url: string) => output("web.control", { action: "open", url }),
    snapshot: (options?: { maxChars?: number }) => output("web.control", { action: "snapshot", ...options }),
    click: (ref: string) => output("web.control", { action: "click", ref }),
    type: (ref: string, text: string, options?: { submit?: boolean; clear?: boolean }) =>
      output("web.control", { action: "type", ref, text, ...options }),
    pressKey: (key: string, modifiers?: string[]) => output("web.control", { action: "pressKey", key, modifiers }),
    waitFor: (options: { text?: string; ref?: string; timeoutMs?: number }) =>
      output("web.control", { action: "waitFor", ...options }),
    extract: (selector: string, options?: { attribute?: string; limit?: number }) =>
      output("web.control", { action: "extract", selector, ...options }),
    screenshot: (path: string) => output("web.control", { action: "screenshot", path }),
    back: () => output("web.control", { action: "back" }),
    reload: () => output("web.control", { action: "reload" }),
  } as Parameters<typeof createWebControlModelTool>[0];

  const desktopController = {
    inspect: () => output("desktop.inspect", {}),
    capabilities: () => output("desktop.capabilities", {}),
    screenshot: (path?: string) => output("desktop.screenshot", { path }),
    focusWindow: (id: unknown) => output("desktop.input", { action: "focus", id }, true),
    closeWindow: (id: unknown) => output("desktop.input", { action: "close", id }, true),
    typeText: (text: unknown) => output("desktop.input", { action: "type", text }, true),
    pressKeys: (combo: unknown) => output("desktop.input", { action: "keys", combo }, true),
    moveMouse: (x: unknown, y: unknown) => output("desktop.input", { action: "moveMouse", x, y }, true),
    click: (button?: unknown, options?: { x?: unknown; y?: unknown; double?: boolean }) =>
      output("desktop.input", { action: "click", button, ...options }, true),
    scroll: (direction: unknown, amount?: unknown) =>
      output("desktop.input", { action: "scroll", direction, amount }, true),
  } as Parameters<typeof createDesktopControlModelTool>[0];

  const googleServices = {
    auth: {
      status: () => output("google.auth", { action: "status" }),
      startLogin: () => output("google.auth", { action: "startLogin" }),
      waitForLogin: () => output("google.auth", { action: "waitForLogin" }),
      logout: () => output("google.auth", { action: "logout" }, true),
    },
    api: {
      listMessages: (input?: unknown) => output("google.read", { action: "listMessages", input }),
      readMessage: (id: string) => output("google.read", { action: "readMessage", id }),
      listEvents: (input?: unknown) => output("google.read", { action: "listEvents", input }),
      // Los envios no usan output(): la politica los marca como confirmables y
      // output() convertiria esa pausa en un error sin salida. El servicio
      // devuelve la pregunta y el confirmationId para que el modelo la traslade.
      sendMessage: (input: unknown) => options.googleSend.request("sendMessage", input),
      replyToMessage: (input: unknown) => options.googleSend.request("replyToMessage", input),
      createEvent: (input: unknown) => options.googleSend.request("createEvent", input),
      deleteEvent: (id: string) => options.googleSend.request("deleteEvent", { id }),
      markAsRead: (id: string) => output("google.read", { action: "markAsRead", id }),
    },
    pending: {
      confirm: (confirmationId: string) => options.googleSend.confirm(confirmationId),
      deny: (confirmationId: string) => options.googleSend.deny(confirmationId),
    },
  } as unknown as GoogleToolServices;

  const setupService: OpenClawSetupToolService = {
    status: () => output("setup.status", {}),
    run: () => output("setup.run", {}),
    startCodexLogin: () => output("auth.codex.start", {}),
    codexLoginStatus: () => output("setup.status", {}),
    configureTelegram: (token) => output("telegram.configure", { token }),
    testTelegram: () => output("telegram.test", {}),
    enableTelegram: () => output("telegram.enable", {}),
  };

  const customTools: PiCustomToolLike[] = [
    createOpenBrowserModelTool(async (url, launcherOptions) => output("browser.open_url", {
      url,
      workspace: launcherOptions?.workspace,
      focus: launcherOptions?.focus,
    })),
    createOpenAppModelTool({
      openApp: (input) => output("apps.open", input),
    }),
    createPackageInstallModelTool(options.packageService),
    createOpenFileModelTool({
      openPath: (input) => output("files.open", input),
    }),
    createFilesContentModelTool(filesContentClient),
    createComputerRunModelTool(computerRunService),
    createWebControlModelTool(webController),
    createDesktopControlModelTool(desktopController),
    createGoogleModelTool(googleServices),
    createOpenClawSetupModelTool(setupService),
    createAgentTaskModelTool(agentTaskClient),
    createLearningMemoryModelTool(learningMemoryClient),
    createImprovementsModelTool(improvementsClient),
  ];

  return {
    modelTools: customTools.map((tool) => tool.name),
    customTools,
    agentTaskClient,
    learningMemoryClient,
    improvementsClient,
  };
}
