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

import type {
  PiAuthAttemptResponse,
  PiAuthAttemptStatus,
  PiChatRequest,
  PiChatResponse,
  PiPendingAttempt,
  PiStatusResponse,
} from "../../../ui/src/lib/pi-types";

export const PI_PROVIDER_ID = "openai-codex" as const;
export const PI_PROVIDER_NAME = "ChatGPT Plus/Pro (Codex Subscription)";
export const PI_AUTH_TTL_MS = 10 * 60 * 1000;

export type PiHarnessPathEnv = {
  readonly [key: string]: string | undefined;
  AGENOS_PI_AGENT_DIR?: string;
};

export type PiHarnessPaths = {
  agentDir: string;
  authPath: string;
};

export function resolvePiHarnessPaths(
  env: PiHarnessPathEnv = process.env,
  home = homedir(),
): PiHarnessPaths {
  const agentDir = env.AGENOS_PI_AGENT_DIR?.trim() || join(home, ".agenos", "ui-dev", "pi");

  return {
    agentDir,
    authPath: join(agentDir, "auth.json"),
  };
}

const PI_PATHS = resolvePiHarnessPaths();
const PI_AGENT_DIR = PI_PATHS.agentDir;
const PI_AUTH_PATH = PI_PATHS.authPath;
const PI_SYSTEM_PROMPT = [
  "Responde siempre en espanol.",
  "Se breve y util.",
  "No inventes acceso a sistema, archivos o acciones externas.",
  "Si algo requiere capacidades no disponibles en este MVP, dilo claramente.",
].join("\n");
const PI_AUTH_INSTRUCTIONS =
  "Completa el login de ChatGPT/Codex en este PC. Si el callback automatico no termina, pega aqui la URL final o el codigo.";

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

type PiHarnessDependencies = {
  authStorage: PiAuthStorageLike;
  modelRegistry: PiModelRegistryLike;
  createSessionManager: () => PiSessionManagerLike;
  createAgentSession: (options: {
    model: PiModelLike;
    sessionManager: PiSessionManagerLike;
  }) => Promise<{ session: PiAgentSessionLike }>;
  loginOpenAICodex: (options: PiLoginOpenAICodexOptions) => Promise<OAuthCredentials>;
  now: () => number;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type LoginAttempt = {
  attemptId: string;
  status: PiAuthAttemptStatus;
  url?: string;
  instructions?: string;
  expiresAt: string;
  error?: string;
  authInfo: Deferred<PiPendingAttempt>;
  manualInput: Deferred<string>;
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
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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

function toPendingAttempt(attempt: LoginAttempt): PiPendingAttempt {
  return {
    attemptId: attempt.attemptId,
    method: "browser",
    url: attempt.url ?? "",
    instructions: attempt.instructions ?? PI_AUTH_INSTRUCTIONS,
    expiresAt: attempt.expiresAt,
  };
}

function toAttemptResponse(attempt: LoginAttempt): PiAuthAttemptResponse {
  return {
    attemptId: attempt.attemptId,
    method: "browser",
    status: attempt.status,
    url: attempt.url,
    instructions: attempt.instructions,
    expiresAt: attempt.expiresAt,
    error: attempt.error,
  };
}

function createDefaultDependencies(): PiHarnessDependencies {
  const authStorage = AuthStorage.create(PI_AUTH_PATH);
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  return {
    authStorage,
    modelRegistry,
    createSessionManager: () => SessionManager.inMemory(process.cwd()),
    createAgentSession: async ({ model, sessionManager }) => {
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

      return createAgentSession({
        cwd: process.cwd(),
        agentDir: PI_AGENT_DIR,
        authStorage,
        modelRegistry,
        model: model as never,
        thinkingLevel: "minimal",
        tools: [],
        sessionManager: sessionManager as SessionManager,
        settingsManager,
        resourceLoader,
      });
    },
    loginOpenAICodex,
    now: () => Date.now(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

export class PiHarness {
  private readonly deps: PiHarnessDependencies;
  private readonly attempts = new Map<string, LoginAttempt>();
  private sessionManager: PiSessionManagerLike;
  private session: PiAgentSessionLike | undefined;
  private sessionModelId: string | undefined;
  private pendingAttemptId: string | undefined;
  private busy = false;
  private lastError: string | undefined;

  constructor(dependencies: PiHarnessDependencies) {
    this.deps = dependencies;
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
      error: authFailure ? this.lastError : undefined,
    };
  }

  async startAuth(): Promise<PiPendingAttempt> {
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
      status: "pending",
      expiresAt,
      authInfo,
      manualInput,
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
      authInfo.reject(new Error(attempt.error));
      manualInput.reject(new Error("Login attempt expired"));
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

    const value = input.trim();
    if (!value) {
      throw new PiHarnessError(400, "Pega la URL de retorno completa o el codigo.");
    }

    attempt.manualInput.resolve(value);
    return toAttemptResponse(attempt);
  }

  logout(): void {
    const pendingAttempt = this.pendingAttemptId ? this.attempts.get(this.pendingAttemptId) : undefined;
    if (pendingAttempt?.status === "pending") {
      pendingAttempt.status = "error";
      pendingAttempt.error = "Login cancelado.";
      pendingAttempt.authInfo.reject(new Error(pendingAttempt.error));
      pendingAttempt.manualInput.reject(new Error(pendingAttempt.error));
      this.clearAttemptTimer(pendingAttempt);
      this.pendingAttemptId = undefined;
    }

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
      unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          streamedReply += event.assistantMessageEvent.delta ?? "";
        }

        if (event.type === "message_end" && event.message?.role === "assistant") {
          completedReply = extractTextContent(event.message.content);
        }
      });

      await session.prompt(message);

      const reply = (streamedReply || completedReply || this.getLastAssistantReply(session)).trim();
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
      const credentials = await this.deps.loginOpenAICodex({
        originator: "pi",
        onAuth: (info) => {
          attempt.url = info.url;
          attempt.instructions = info.instructions ?? PI_AUTH_INSTRUCTIONS;
          attempt.authInfo.resolve(toPendingAttempt(attempt));
        },
        onPrompt: async () => attempt.manualInput.promise,
        onManualCodeInput: async () => attempt.manualInput.promise,
      });

      attempt.status = "success";
      this.deps.authStorage.set(PI_PROVIDER_ID, {
        type: "oauth",
        ...credentials,
      });
      this.lastError = undefined;
      this.pendingAttemptId = this.pendingAttemptId === attempt.attemptId ? undefined : this.pendingAttemptId;
    } catch (error) {
      if (attempt.status === "expired") {
        return;
      }

      const message = normalizeErrorMessage(error);
      attempt.status = "error";
      attempt.error = message;
      attempt.authInfo.reject(error);
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
      models.find((model) => model.id === "gpt-5.4-mini")
      ?? models.find((model) => model.id === "gpt-5.4")
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
      || normalized.includes("conecta chatgpt");
  }
}

let sharedHarness: PiHarness | undefined;

export function createPiHarness(dependencies?: Partial<PiHarnessDependencies>): PiHarness {
  if (dependencies) {
    return new PiHarness(dependencies as PiHarnessDependencies);
  }

  sharedHarness ??= new PiHarness(createDefaultDependencies());
  return sharedHarness;
}
