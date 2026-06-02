import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OAuthCredentials, OAuthPrompt } from "@mariozechner/pi-ai/oauth";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

import { PI_SYSTEM_CONTEXT_MARKDOWN } from "../../agent/pi-system-context";
import { createAppTool, type AppInstallResponse, type AppOpenResponse } from "../../agent/apps";
import type {
  PiAuthAttemptResponse,
  PiAuthMethod,
  PiAuthAttemptStatus,
  PiChatRequest,
  PiChatResponse,
  PiPendingAttempt,
  PiStatusResponse,
} from "../src/lib/pi-types";

export const PI_PROVIDER_ID = "openai-codex" as const;
export const PI_PROVIDER_NAME = "ChatGPT Plus/Pro (Codex Subscription)";
export const PI_AUTH_TTL_MS = 15 * 60 * 1000;

export type PiHarnessPathEnv = {
  readonly [key: string]: string | undefined;
  AGENOS_PI_AGENT_DIR?: string;
};

export type PiHarnessPaths = {
  agentDir: string;
  authPath: string;
  codexDeviceDir: string;
};

export function resolvePiHarnessPaths(
  env: PiHarnessPathEnv = process.env,
  home = homedir(),
): PiHarnessPaths {
  const agentDir = env.AGENOS_PI_AGENT_DIR?.trim() || join(home, ".agenos", "ui-dev", "pi");

  return {
    agentDir,
    authPath: join(agentDir, "auth.json"),
    codexDeviceDir: join(agentDir, "codex-device"),
  };
}

const PI_PATHS = resolvePiHarnessPaths();
const PI_AGENT_DIR = PI_PATHS.agentDir;
const PI_AUTH_PATH = PI_PATHS.authPath;
const PI_CODEX_DEVICE_DIR = PI_PATHS.codexDeviceDir;
export const PI_SYSTEM_PROMPT = PI_SYSTEM_CONTEXT_MARKDOWN;
const PI_AUTH_INSTRUCTIONS =
  "Completa el login de ChatGPT/Codex en este PC. Si el callback automatico no termina, pega aqui la URL final o el codigo.";
const PI_DEVICE_AUTH_INSTRUCTIONS =
  "Abre el enlace en cualquier navegador, inicia sesion con ChatGPT y escribe el codigo mostrado.";
const FOREGROUND_MODEL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "apps_open", "apps_install"];
const FOREGROUND_TOOL_RESULT_NAMES = new Set(FOREGROUND_MODEL_TOOLS);

type PiModelLike = {
  id: string;
  provider: string;
};

type PiMessageLike = {
  role?: string;
  content?: unknown;
};

type PiAgentEventLike = {
  type: string;
  message?: PiMessageLike;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
};

type PiAgentSessionLike = {
  subscribe(listener: (event: PiAgentEventLike) => void): () => void;
  prompt(text: string): Promise<void>;
  dispose?(): void;
  state?: {
    messages?: PiMessageLike[];
  };
  model?: PiModelLike;
};

type PiSessionManagerLike = object;

type PiAuthStorageLike = {
  get(provider: string): { type?: string } | undefined;
  set(provider: string, credential: { type: "oauth" } & OAuthCredentials): void;
  logout(provider: string): void;
};

type PiModelRegistryLike = {
  getAll(): PiModelLike[];
};

type PiLoginOpenAICodexOptions = {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  originator?: string;
};

type CodexDeviceAuthUpdate = {
  url?: string;
  userCode?: string;
};

type CodexDeviceAuthOptions = {
  codexHome: string;
  signal: AbortSignal;
  onAuth: (info: CodexDeviceAuthUpdate) => void;
};

type AppToolLike = {
  openApp(input: string | { app?: unknown; workspace?: unknown; focus?: unknown }): Promise<AppOpenResponse>;
  installApp(input: string, options?: { openAfterInstall?: boolean; openAs?: string }): Promise<AppInstallResponse>;
};

type PiCustomToolLike = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

type PiHarnessDependencies = {
  authStorage: PiAuthStorageLike;
  modelRegistry: PiModelRegistryLike;
  createSessionManager: () => PiSessionManagerLike;
  createAgentSession: (options: {
    model: PiModelLike;
    sessionManager: PiSessionManagerLike;
    tools?: string[];
    customTools?: PiCustomToolLike[];
  }) => Promise<{ session: PiAgentSessionLike }>;
  appTool: AppToolLike;
  loginOpenAICodex: (options: PiLoginOpenAICodexOptions) => Promise<OAuthCredentials>;
  loginOpenAICodexDevice: (options: CodexDeviceAuthOptions) => Promise<OAuthCredentials>;
  now: () => number;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

type PiHarnessOptions = {
  onAuth?: (info: { url: string; instructions?: string }, attempt: LoginAttempt) => void;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  settled: boolean;
};

type LoginAttempt = {
  attemptId: string;
  method: PiAuthMethod;
  status: PiAuthAttemptStatus;
  url?: string;
  instructions?: string;
  userCode?: string;
  expiresAt: string;
  error?: string;
  authInfo: Deferred<PiPendingAttempt>;
  manualInput: Deferred<string>;
  abortController: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
};

export class PiHarnessError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = (value) => {
      deferred.settled = true;
      resolvePromise(value);
    };
    reject = (reason) => {
      deferred.settled = true;
      rejectPromise(reason);
    };
  });

  void promise.catch(() => undefined);
  const deferred = { promise, resolve, reject, settled: false };
  return deferred;
}

function rejectDeferred<T>(deferred: Deferred<T>, reason: unknown): void {
  if (!deferred.settled) {
    deferred.reject(reason);
  }
}

function resolveDeferred<T>(deferred: Deferred<T>, value: T): void {
  if (!deferred.settled) {
    deferred.resolve(value);
  }
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object" || !("type" in item)) {
        return "";
      }

      const candidate = item as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join("");
}

function extractToolResultContent(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return undefined;
  }

  return (result as { content?: unknown }).content;
}

const OPEN_APP_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    app: {
      type: "string",
      description: "Nombre de la aplicacion local instalada que se quiere abrir. Ejemplos: Chrome, VLC, GIMP, terminal, archivos.",
    },
    workspace: {
      type: "number",
      description: "Workspace de AgenOS donde abrir la app: 1 agent, 2 apps, 3 web, 4 media, 5 work.",
    },
    focus: {
      type: "boolean",
      description: "Cambiar el foco del usuario al workspace. Por defecto true.",
    },
  },
  required: ["app"],
  additionalProperties: false,
};

const INSTALL_APP_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    package: {
      type: "string",
      description: "Nombre del paquete Debian a instalar, por ejemplo vlc, gimp o libreoffice.",
    },
    app: {
      type: "string",
      description: "Nombre de la aplicacion a abrir despues de instalar si difiere del paquete.",
    },
    openAfterInstall: {
      type: "boolean",
      description: "Abrir la aplicacion despues de instalarla. Por defecto true.",
    },
  },
  required: ["package"],
  additionalProperties: false,
};

function createOpenAppModelTool(appTool: AppToolLike): PiCustomToolLike {
  return {
    name: "apps_open",
    label: "Abrir app",
    description: "Abre una aplicacion local instalada en AgenOS cuando el usuario lo pide explicitamente.",
    promptSnippet: "apps_open: abre aplicaciones locales instaladas como Chrome, VLC, GIMP, archivos o terminal.",
    promptGuidelines: [
      "Si el usuario pide abrir una aplicacion instalada, llama apps_open con el nombre de la aplicacion.",
      "No pidas confirmacion para apps_open cuando la peticion venga del usuario actual.",
    ],
    parameters: OPEN_APP_TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const response = await appTool.openApp({
        app: typeof params.app === "string" ? params.app : "",
        workspace: params.workspace,
        focus: typeof params.focus === "boolean" ? params.focus : true,
      });
      return {
        content: [{ type: "text", text: response.message ?? "Solicitud de apertura procesada." }],
        details: response,
      };
    },
  };
}

function createInstallAppModelTool(appTool: AppToolLike): PiCustomToolLike {
  return {
    name: "apps_install",
    label: "Instalar app",
    description: "Instala un paquete Debian y opcionalmente abre la aplicacion instalada.",
    promptSnippet: "apps_install: instala paquetes Debian cuando el usuario lo pide, y puede abrir la app al terminar.",
    promptGuidelines: [
      "Si el usuario pide instalar una app o paquete, llama apps_install con el nombre del paquete Debian.",
      "Si el usuario pide instalar y abrir una app, deja openAfterInstall en true y usa app si el nombre de apertura difiere del paquete.",
      "No uses apps_install para paquetes que el usuario no haya pedido instalar.",
    ],
    parameters: INSTALL_APP_TOOL_PARAMETERS,
    async execute(_toolCallId, params) {
      const response = await appTool.installApp(
        typeof params.package === "string" ? params.package : "",
        {
          openAfterInstall: typeof params.openAfterInstall === "boolean" ? params.openAfterInstall : true,
          openAs: typeof params.app === "string" ? params.app : undefined,
        },
      );
      return {
        content: [{ type: "text", text: response.message ?? "Solicitud de instalacion procesada." }],
        details: response,
      };
    },
  };
}

function toPendingAttempt(attempt: LoginAttempt): PiPendingAttempt {
  return {
    attemptId: attempt.attemptId,
    method: attempt.method,
    url: attempt.url ?? "",
    instructions: attempt.instructions ?? PI_AUTH_INSTRUCTIONS,
    expiresAt: attempt.expiresAt,
    userCode: attempt.userCode,
  };
}

function toAttemptResponse(attempt: LoginAttempt): PiAuthAttemptResponse {
  return {
    attemptId: attempt.attemptId,
    method: attempt.method,
    status: attempt.status,
    url: attempt.url,
    instructions: attempt.instructions,
    expiresAt: attempt.expiresAt,
    userCode: attempt.userCode,
    error: attempt.error,
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}

function parseCodexDeviceAuthOutput(rawOutput: string): CodexDeviceAuthUpdate {
  const output = stripAnsi(rawOutput);
  const url = output.match(/https:\/\/auth\.openai\.com\/codex\/device\b/)?.[0];
  const codeMatches = [...output.matchAll(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/g)];
  const userCode = codeMatches.length > 0 ? codeMatches[codeMatches.length - 1]?.[0] : undefined;

  return { url, userCode };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (!payload) {
      return null;
    }

    const padded = payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function accountIdFromAccessToken(accessToken: string): string | undefined {
  const auth = decodeJwtPayload(accessToken)?.["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") {
    return undefined;
  }

  const accountId = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
  return typeof accountId === "string" && accountId ? accountId : undefined;
}

function expiryFromAccessToken(accessToken: string): number | undefined {
  const exp = decodeJwtPayload(accessToken)?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}

async function readCodexDeviceCredentials(codexHome: string): Promise<OAuthCredentials> {
  const raw = await readFile(join(codexHome, "auth.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    tokens?: {
      access_token?: unknown;
      refresh_token?: unknown;
      id_token?: unknown;
      account_id?: unknown;
    };
    account_id?: unknown;
  };

  const access = parsed.tokens?.access_token;
  const refresh = parsed.tokens?.refresh_token;
  const idToken = parsed.tokens?.id_token;
  if (typeof access !== "string" || typeof refresh !== "string") {
    throw new Error("Codex no escribio credenciales OAuth completas.");
  }

  const accountId = typeof parsed.account_id === "string" && parsed.account_id
    ? parsed.account_id
    : typeof parsed.tokens?.account_id === "string" && parsed.tokens.account_id
      ? parsed.tokens.account_id
      : accountIdFromAccessToken(access)
        ?? (typeof idToken === "string" ? accountIdFromAccessToken(idToken) : undefined);
  if (!accountId) {
    throw new Error("No se pudo leer el accountId de Codex.");
  }

  return {
    access,
    refresh,
    expires: expiryFromAccessToken(access) ?? Date.now() + 60 * 60 * 1000,
    accountId,
  };
}

async function loginOpenAICodexDevice(options: CodexDeviceAuthOptions): Promise<OAuthCredentials> {
  await mkdir(options.codexHome, { recursive: true });

  return new Promise<OAuthCredentials>((resolve, reject) => {
    const child = spawn(process.env.AGENOS_CODEX_BIN?.trim() || "codex", ["login", "--device-auth"], {
      env: {
        ...process.env,
        CODEX_HOME: options.codexHome,
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      options.signal.removeEventListener("abort", abortLogin);
      callback();
    };

    const abortLogin = () => {
      child.kill("SIGTERM");
      settle(() => reject(new Error("Login cancelado.")));
    };

    const consume = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const info = parseCodexDeviceAuthOutput(output);
      if (info.url || info.userCode) {
        options.onAuth(info);
      }
    };

    options.signal.addEventListener("abort", abortLogin, { once: true });
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.on("error", (error) => {
      settle(() => reject(new Error(`No se pudo ejecutar codex login --device-auth: ${error.message}`)));
    });
    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }

      if (code !== 0) {
        const suffix = signal ? ` (${signal})` : "";
        settle(() => reject(new Error(`codex login --device-auth termino con codigo ${code ?? "desconocido"}${suffix}.`)));
        return;
      }

      void readCodexDeviceCredentials(options.codexHome)
        .then((credentials) => settle(() => resolve(credentials)))
        .catch((error) => settle(() => reject(error)));
    });
  });
}

function createDefaultDependencies(): PiHarnessDependencies {
  const authStorage = AuthStorage.create(PI_AUTH_PATH);
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const appTool = createAppTool();

  return {
    authStorage,
    modelRegistry,
    createSessionManager: () => SessionManager.inMemory(process.cwd()),
    createAgentSession: async ({ model, sessionManager, tools, customTools }) => {
      const settingsManager = SettingsManager.inMemory();
      const resourceLoader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: PI_AGENT_DIR,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPromptOverride: () => PI_SYSTEM_PROMPT,
        appendSystemPromptOverride: () => [],
      });

      await resourceLoader.reload();

      const created = await createAgentSession({
        cwd: process.cwd(),
        agentDir: PI_AGENT_DIR,
        authStorage,
        modelRegistry,
        model: model as never,
        thinkingLevel: "minimal",
        tools: tools ?? FOREGROUND_MODEL_TOOLS,
        customTools: (customTools ?? [
          createOpenAppModelTool(appTool),
          createInstallAppModelTool(appTool),
        ]) as never,
        sessionManager: sessionManager as SessionManager,
        settingsManager,
        resourceLoader,
      });

      return { session: created.session as unknown as PiAgentSessionLike };
    },
    appTool,
    loginOpenAICodex,
    loginOpenAICodexDevice,
    now: () => Date.now(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

export class PiHarness {
  private readonly deps: PiHarnessDependencies;
  private readonly options: PiHarnessOptions;
  private readonly attempts = new Map<string, LoginAttempt>();
  private sessionManager: PiSessionManagerLike;
  private session: PiAgentSessionLike | undefined;
  private sessionModelId: string | undefined;
  private pendingAttemptId: string | undefined;
  private busy = false;
  private lastError: string | undefined;

  constructor(dependencies: PiHarnessDependencies, options: PiHarnessOptions = {}) {
    this.deps = dependencies;
    this.options = options;
    this.sessionManager = this.deps.createSessionManager();
  }

  getStatus(): PiStatusResponse {
    const pendingAttempt = this.pendingAttemptId ? this.attempts.get(this.pendingAttemptId) : undefined;
    const authFailure = this.lastError && this.isAuthenticationFailure(this.lastError);

    return {
      authState: pendingAttempt?.status === "pending"
        ? "authorizing"
        : authFailure
          ? "error"
          : this.isAuthenticated()
            ? "connected"
            : "disconnected",
      providerName: PI_PROVIDER_NAME,
      modelId: this.selectModel().id,
      busy: this.busy,
      pendingAttempt: pendingAttempt?.status === "pending" ? toPendingAttempt(pendingAttempt) : undefined,
      error: this.lastError,
    };
  }

  async startAuth(method: PiAuthMethod = "device"): Promise<PiPendingAttempt> {
    const currentAttempt = this.pendingAttemptId ? this.attempts.get(this.pendingAttemptId) : undefined;
    if (currentAttempt?.status === "pending") {
      return currentAttempt.authInfo.promise;
    }

    const attemptId = `att_${this.deps.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(this.deps.now() + PI_AUTH_TTL_MS).toISOString();
    const authInfo = createDeferred<PiPendingAttempt>();
    const manualInput = createDeferred<string>();
    const attempt: LoginAttempt = {
      attemptId,
      method,
      status: "pending",
      expiresAt,
      authInfo,
      manualInput,
      abortController: new AbortController(),
      timer: null,
    };

    this.attempts.set(attemptId, attempt);
    this.pendingAttemptId = attemptId;
    this.lastError = undefined;

    attempt.timer = this.deps.setTimeout(() => {
      if (attempt.status !== "pending") {
        return;
      }

      attempt.status = "expired";
      attempt.error = "El intento de login expiro.";
      this.lastError = attempt.error;
      this.pendingAttemptId = this.pendingAttemptId === attempt.attemptId ? undefined : this.pendingAttemptId;
      attempt.abortController.abort();
      rejectDeferred(authInfo, new Error(attempt.error));
      rejectDeferred(manualInput, new Error("Login attempt expired"));
    }, PI_AUTH_TTL_MS);

    void this.runAuthAttempt(attempt);

    return authInfo.promise;
  }

  getAuthAttempt(attemptId: string): PiAuthAttemptResponse {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) {
      throw new PiHarnessError(404, "Intento de login no encontrado.");
    }

    return toAttemptResponse(attempt);
  }

  submitManualCode(attemptId: string, input: string): PiAuthAttemptResponse {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) {
      throw new PiHarnessError(404, "Intento de login no encontrado.");
    }

    if (attempt.status === "expired") {
      throw new PiHarnessError(410, "El intento de login ya expiro.");
    }

    if (attempt.status === "success") {
      return toAttemptResponse(attempt);
    }

    if (attempt.status === "error") {
      throw new PiHarnessError(409, attempt.error ?? "El intento de login ya fallo.");
    }

    if (attempt.status === "cancelled") {
      throw new PiHarnessError(409, "El intento de login fue cancelado.");
    }

    const value = input.trim();
    if (!value) {
      throw new PiHarnessError(400, "Pega la URL de retorno completa o el codigo.");
    }

    attempt.manualInput.resolve(value);
    return toAttemptResponse(attempt);
  }

  cancelAuth(attemptId?: string): PiAuthAttemptResponse | null {
    const pendingAttempt = this.pendingAttemptId ? this.attempts.get(this.pendingAttemptId) : undefined;
    if (!pendingAttempt || pendingAttempt.status !== "pending") {
      return null;
    }

    if (attemptId && attemptId !== pendingAttempt.attemptId) {
      throw new PiHarnessError(409, "Hay otro login en curso.");
    }

    pendingAttempt.status = "cancelled";
    pendingAttempt.error = "Login cancelado.";
    pendingAttempt.abortController.abort();
    rejectDeferred(pendingAttempt.authInfo, new Error(pendingAttempt.error));
    rejectDeferred(pendingAttempt.manualInput, new Error(pendingAttempt.error));
    this.clearAttemptTimer(pendingAttempt);
    this.pendingAttemptId = undefined;
    this.lastError = undefined;
    return toAttemptResponse(pendingAttempt);
  }

  logout(): void {
    this.cancelAuth();

    this.deps.authStorage.logout(PI_PROVIDER_ID);
    this.lastError = undefined;
    this.resetSession();
  }

  async chat(request: PiChatRequest): Promise<PiChatResponse> {
    const message = request.message.trim();
    if (!message) {
      throw new PiHarnessError(400, "Escribe un mensaje.");
    }

    if (!this.isAuthenticated()) {
      throw new PiHarnessError(401, "Conecta ChatGPT antes de enviar mensajes.");
    }

    if (this.busy) {
      throw new PiHarnessError(409, "Ya hay una respuesta en curso.");
    }

    this.busy = true;
    let unsubscribe = () => {};

    try {
      const model = this.selectModel();
      const session = await this.ensureSession(model);
      let streamedReply = "";
      let completedReply = "";
      let toolReply = "";
      unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          streamedReply += event.assistantMessageEvent.delta ?? "";
        }

        if (event.type === "message_end" && event.message?.role === "assistant") {
          completedReply = extractTextContent(event.message.content);
        }

        if (event.type === "tool_execution_end" && event.toolName && FOREGROUND_TOOL_RESULT_NAMES.has(event.toolName) && !event.isError) {
          toolReply = extractTextContent(extractToolResultContent(event.result));
        }
      });

      await session.prompt(message);

      const reply = (streamedReply || completedReply || toolReply || this.getLastAssistantReply(session)).trim();
      if (!reply) {
        throw new Error("No se recibio respuesta del agente.");
      }

      this.lastError = undefined;

      return {
        ok: true,
        reply,
        provider: PI_PROVIDER_ID,
        modelId: model.id,
      };
    } catch (error) {
      const message = normalizeErrorMessage(error);
      this.lastError = message;

      if (this.isAuthenticationFailure(message)) {
        throw new PiHarnessError(401, message);
      }

      throw new PiHarnessError(500, message);
    } finally {
      unsubscribe();
      this.busy = false;
    }
  }

  private async runAuthAttempt(attempt: LoginAttempt): Promise<void> {
    try {
      const credentials = attempt.method === "device"
        ? await this.deps.loginOpenAICodexDevice({
          codexHome: PI_CODEX_DEVICE_DIR,
          signal: attempt.abortController.signal,
          onAuth: (info) => {
            if (attempt.status !== "pending" || this.pendingAttemptId !== attempt.attemptId) {
              return;
            }

            attempt.url = info.url ?? attempt.url;
            attempt.userCode = info.userCode ?? attempt.userCode;
            attempt.instructions = PI_DEVICE_AUTH_INSTRUCTIONS;
            if (attempt.url) {
              this.options.onAuth?.({ url: attempt.url, instructions: attempt.instructions }, attempt);
            }
            if (attempt.url && attempt.userCode && !attempt.authInfo.settled) {
              resolveDeferred(attempt.authInfo, toPendingAttempt(attempt));
            }
          },
        })
        : await this.deps.loginOpenAICodex({
          originator: "pi",
          onAuth: (info) => {
            if (attempt.status !== "pending" || this.pendingAttemptId !== attempt.attemptId) {
              return;
            }

            attempt.url = info.url;
            attempt.instructions = info.instructions ?? PI_AUTH_INSTRUCTIONS;
            this.options.onAuth?.({ url: attempt.url, instructions: attempt.instructions }, attempt);
            resolveDeferred(attempt.authInfo, toPendingAttempt(attempt));
          },
          onPrompt: async () => attempt.manualInput.promise,
          onManualCodeInput: async () => attempt.manualInput.promise,
        });

      if (attempt.status !== "pending" || this.pendingAttemptId !== attempt.attemptId) {
        return;
      }

      attempt.status = "success";
      resolveDeferred(attempt.authInfo, toPendingAttempt(attempt));
      this.deps.authStorage.set(PI_PROVIDER_ID, {
        type: "oauth",
        ...credentials,
      });
      this.lastError = undefined;
      this.pendingAttemptId = this.pendingAttemptId === attempt.attemptId ? undefined : this.pendingAttemptId;
    } catch (error) {
      if (attempt.status !== "pending") {
        return;
      }

      const message = normalizeErrorMessage(error);
      attempt.status = "error";
      attempt.error = message;
      rejectDeferred(attempt.authInfo, error);
      this.pendingAttemptId = this.pendingAttemptId === attempt.attemptId ? undefined : this.pendingAttemptId;
    } finally {
      this.clearAttemptTimer(attempt);
    }
  }

  private clearAttemptTimer(attempt: LoginAttempt): void {
    if (attempt.timer) {
      this.deps.clearTimeout(attempt.timer);
      attempt.timer = null;
    }
  }

  private isAuthenticated(): boolean {
    return this.deps.authStorage.get(PI_PROVIDER_ID)?.type === "oauth";
  }

  private selectModel(): PiModelLike {
    const models = [...this.deps.modelRegistry.getAll()]
      .filter((model) => model.provider === PI_PROVIDER_ID)
      .sort((left, right) => left.id.localeCompare(right.id));

    const preferred =
      models.find((model) => model.id === "gpt-5.4")
      ?? models.find((model) => model.id === "gpt-5.4-mini")
      ?? models[0];

    if (!preferred) {
      throw new PiHarnessError(500, "No hay modelos openai-codex disponibles.");
    }

    return preferred;
  }

  private async ensureSession(model: PiModelLike): Promise<PiAgentSessionLike> {
    if (this.session && this.sessionModelId === model.id) {
      return this.session;
    }

    this.session?.dispose?.();

    const created = await this.deps.createAgentSession({
      model,
      sessionManager: this.sessionManager,
      tools: FOREGROUND_MODEL_TOOLS,
      customTools: [
        createOpenAppModelTool(this.deps.appTool),
        createInstallAppModelTool(this.deps.appTool),
      ],
    });

    this.session = created.session;
    this.sessionModelId = model.id;
    return created.session;
  }

  private resetSession(): void {
    this.session?.dispose?.();
    this.session = undefined;
    this.sessionModelId = undefined;
    this.sessionManager = this.deps.createSessionManager();
  }

  private getLastAssistantReply(session: PiAgentSessionLike): string {
    const messages = session.state?.messages;
    if (!Array.isArray(messages)) {
      return "";
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "assistant") {
        return extractTextContent(message.content);
      }
    }

    return "";
  }

  private isAuthenticationFailure(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes("authentication failed")
      || normalized.includes("no api key found")
      || normalized.includes("run '/login")
      || normalized.includes("conecta chatgpt")
      || normalized.includes("unauthorized")
      || normalized.includes("invalid_token")
      || normalized.includes("token_invalidated")
      || normalized.includes("refresh_token")
      || normalized.includes("not_chatgpt_auth")
      || normalized.includes("missing_codex_entitlement")
      || normalized.includes("chatgpt token not available")
      || normalized.includes("chatgpt account id not available");
  }
}

let sharedHarness: PiHarness | undefined;

export function createPiHarness(dependencies?: Partial<PiHarnessDependencies>, options: PiHarnessOptions = {}): PiHarness {
  if (dependencies) {
    return new PiHarness(dependencies as PiHarnessDependencies, options);
  }

  sharedHarness ??= new PiHarness(createDefaultDependencies(), options);
  return sharedHarness;
}
