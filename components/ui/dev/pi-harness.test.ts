import { describe, expect, test } from "bun:test";

import type { AgentTaskClient } from "../../agent/agent-task-tool";
import type { LearningMemoryClient } from "../../agent/learning-memory-tool";
import { createPiHarness, PI_SYSTEM_PROMPT, resolvePiHarnessPaths, type PiTurnStoreLike } from "./pi-harness";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createHarnessFixture(fixtureOptions: { turnStore?: PiTurnStoreLike; agentTaskClient?: AgentTaskClient; learningMemoryClient?: LearningMemoryClient } = {}) {
  let now = Date.parse("2026-04-21T12:00:00.000Z");
  const authData = new Map<string, { type: "oauth"; access: string; refresh: string; expires: number; accountId: string }>();
  const loginDeferred = createDeferred<{
    access: string;
    refresh: string;
    expires: number;
    accountId: string;
  }>();
  const listeners = new Set<(event: unknown) => void>();
  const pendingTimers: Array<() => void> = [];
  let loginCalls = 0;
  let deviceLoginCalls = 0;
  let loginOptions:
    | {
        onAuth: (info: { url: string; instructions?: string }) => void;
        onPrompt: () => Promise<string>;
        onManualCodeInput?: () => Promise<string>;
      }
    | undefined;
  let promptImpl = async (text: string) => {
    emitAssistantReply(`respuesta:${text}`);
  };
  let createSessionOptions: unknown;
  const openedApps: unknown[] = [];
  const traceRecords: unknown[] = [];

  const session = {
    model: {
      id: "gpt-5.4-mini",
      provider: "openai-codex",
    },
    state: {
      messages: [] as Array<{ role: string; content: Array<{ type: string; text: string }> }>,
    },
    subscribe(listener: (event: unknown) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async prompt(text: string) {
      await promptImpl(text);
    },
    dispose() {},
  };

  function emitAssistantReply(text: string) {
    const message = {
      role: "assistant",
      content: [{ type: "text", text }],
    };

    session.state.messages.push(message);

    for (const listener of listeners) {
      listener({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: text,
        },
        message,
      });
      listener({
        type: "message_end",
        message,
      });
    }
  }

  function emitToolResult(toolName: string, text: string) {
    for (const listener of listeners) {
      listener({
        type: "tool_execution_end",
        toolName,
        result: {
          content: [{ type: "text", text }],
        },
        isError: false,
      });
    }
  }

  function emitToolStart(toolName: string) {
    for (const listener of listeners) {
      listener({
        type: "tool_execution_start",
        toolName,
      });
    }
  }

  function emitToolUpdate(toolName: string, text: string) {
    for (const listener of listeners) {
      listener({
        type: "tool_execution_update",
        toolName,
        partialResult: {
          content: [{ type: "text", text }],
        },
      });
    }
  }

  const harness = createPiHarness({
    authStorage: {
      get(provider) {
        return authData.get(provider);
      },
      set(provider, credential) {
        authData.set(provider, credential);
      },
      logout(provider) {
        authData.delete(provider);
      },
    },
    modelRegistry: {
      getAll() {
        return [
          { id: "gpt-5.5-instant", provider: "openai-codex" },
          { id: "gpt-5.4", provider: "openai-codex" },
          { id: "gpt-5.4-mini", provider: "openai-codex" },
        ];
      },
    },
    createSessionManager: () => ({ createdAt: now }),
    turnStore: fixtureOptions.turnStore,
    createAgentSession: async (options) => {
      createSessionOptions = options;
      return { session };
    },
    appTool: {
      openApp: async (app: unknown) => {
        openedApps.push(app);
        const appName = typeof app === "string"
          ? app
          : app && typeof app === "object" && "app" in app && typeof app.app === "string"
            ? app.app
            : "app";
        return { ok: true, appId: "browser", message: `Abriendo ${appName}.` };
      },
    },
    agentTaskClient: fixtureOptions.agentTaskClient,
    learningMemoryClient: fixtureOptions.learningMemoryClient,
    setupService: {
      status: async () => ({
        phase: "ready",
        message: "Setup listo.",
        actions: [],
        backend: { available: true, mode: "agenos-bun-worker", lastError: null },
        codex: { configured: true, lastError: null },
        telegram: { configured: false, enabled: false, lastError: null },
      }),
      run: async () => ({
        phase: "ready",
        message: "Setup listo.",
        actions: [],
        backend: { available: true, mode: "agenos-bun-worker", lastError: null },
        codex: { configured: true, lastError: null },
        telegram: { configured: false, enabled: false, lastError: null },
      }),
      startCodexLogin: async () => ({ ok: true, message: "Login iniciado.", command: ["codex", "login"] }),
      codexLoginStatus: async () => ({ ok: true, message: "Login pendiente." }),
      configureTelegram: async () => ({ ok: true, message: "Telegram configurado." }),
      testTelegram: async () => ({ ok: true, message: "Telegram probado." }),
      enableTelegram: async () => ({ ok: true, message: "Telegram activado." }),
    },
    traceRecorder: {
      record(record) {
        traceRecords.push(record);
      },
    },
    loginOpenAICodex: async (options) => {
      loginCalls += 1;
      loginOptions = {
        onAuth: options.onAuth,
        onPrompt: () => options.onPrompt({ message: "manual" }),
        onManualCodeInput: options.onManualCodeInput,
      };
      options.onAuth({
        url: "https://auth.example/login",
        instructions: "Completa el login",
      });
      return loginDeferred.promise;
    },
    loginOpenAICodexDevice: async (options) => {
      deviceLoginCalls += 1;
      options.onAuth({
        url: "https://auth.openai.com/codex/device",
        userCode: "ABCD-EFGH",
      });
      return loginDeferred.promise;
    },
    now: () => now,
    setTimeout: (callback) => {
      pendingTimers.push(callback);
      return callback as never;
    },
    clearTimeout: () => {},
  });

  return {
    harness,
    authData,
    loginDeferred,
    emitAssistantReply,
    emitToolResult,
    emitToolStart,
    emitToolUpdate,
    getLoginCalls: () => loginCalls,
    getDeviceLoginCalls: () => deviceLoginCalls,
    getLoginOptions: () => loginOptions,
    getCreateSessionOptions: () => createSessionOptions,
    getOpenedApps: () => openedApps,
    getTraceRecords: () => traceRecords,
    setPromptImpl(nextPromptImpl: typeof promptImpl) {
      promptImpl = nextPromptImpl;
    },
    advanceTimers() {
      pendingTimers.splice(0).forEach((callback) => callback());
    },
    setNow(nextNow: number) {
      now = nextNow;
    },
  };
}

async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function settleTurn() {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

describe("PiHarness", () => {
  test("loads the foreground system prompt from markdown context", () => {
    expect(PI_SYSTEM_PROMPT).toContain("# AgenOS Pi foreground context");
    expect(PI_SYSTEM_PROMPT).toContain("browser_open");
    expect(PI_SYSTEM_PROMPT).toContain("apps_open");
    expect(PI_SYSTEM_PROMPT).not.toContain("apps_install");
    expect(PI_SYSTEM_PROMPT).toContain("files_open");
    expect(PI_SYSTEM_PROMPT).toContain("openclaw_setup");
    expect(PI_SYSTEM_PROMPT).not.toContain("<<<<<<<");
    expect(PI_SYSTEM_PROMPT).not.toContain("[object");
  });

  test("resolves packaged Codex state paths from AGENOS_PI_AGENT_DIR", () => {
    expect(resolvePiHarnessPaths({
      AGENOS_PI_AGENT_DIR: "/home/agenos/.agenos/ui-dev/pi",
    }, "/unused")).toEqual({
      agentDir: "/home/agenos/.agenos/ui-dev/pi",
      authPath: "/home/agenos/.agenos/ui-dev/pi/auth.json",
      codexDeviceDir: "/home/agenos/.agenos/ui-dev/pi/codex-device",
      tracePath: "/home/agenos/.agenos/ui-dev/pi/traces/pi-chat.ndjson",
      turnsPath: "/home/agenos/.agenos/ui-dev/pi/turns.json",
      sessionsDir: "/home/agenos/.agenos/ui-dev/pi/sessions",
    });
  });

  test("defaults Codex state paths under the current home directory", () => {
    expect(resolvePiHarnessPaths({}, "/home/agenos")).toEqual({
      agentDir: "/home/agenos/.agenos/ui-dev/pi",
      authPath: "/home/agenos/.agenos/ui-dev/pi/auth.json",
      codexDeviceDir: "/home/agenos/.agenos/ui-dev/pi/codex-device",
      tracePath: "/home/agenos/.agenos/ui-dev/pi/traces/pi-chat.ndjson",
      turnsPath: "/home/agenos/.agenos/ui-dev/pi/turns.json",
      sessionsDir: "/home/agenos/.agenos/ui-dev/pi/sessions",
    });
  });

  test("rejects chat when there is no auth", async () => {
    const { harness } = createHarnessFixture();

    await expect(harness.chat({
      message: "hola",
      source: "text",
    })).rejects.toMatchObject({
      status: 401,
      message: "Conecta ChatGPT antes de enviar mensajes.",
    });
  });

  test("keeps a single pending login attempt", async () => {
    const { harness, getDeviceLoginCalls } = createHarnessFixture();

    const first = await harness.startAuth();
    const second = await harness.startAuth();

    expect(first.attemptId).toBe(second.attemptId);
    expect(first).toMatchObject({
      method: "device",
      url: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    });
    expect(getDeviceLoginCalls()).toBe(1);
  });

  test("accepts manual code and transitions to connected", async () => {
    const { harness, getLoginOptions, loginDeferred } = createHarnessFixture();

    const attempt = await harness.startAuth("browser");
    const loginOptions = getLoginOptions();
    expect(loginOptions).toBeDefined();

    harness.submitManualCode(attempt.attemptId, "manual-code");
    const manualCode = await loginOptions?.onManualCodeInput?.();
    expect(manualCode).toBe("manual-code");

    loginDeferred.resolve({
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await flushTasks();

    expect(harness.getStatus()).toMatchObject({
      authState: "connected",
      pendingAttempt: undefined,
    });
    expect(harness.getAuthAttempt(attempt.attemptId)).toMatchObject({
      method: "browser",
      status: "success",
    });
  });

  test("device auth credentials transition to connected", async () => {
    const { harness, loginDeferred } = createHarnessFixture();

    const attempt = await harness.startAuth("device");
    expect(attempt).toMatchObject({
      method: "device",
      url: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    });

    loginDeferred.resolve({
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await flushTasks();

    expect(harness.getStatus()).toMatchObject({
      authState: "connected",
      pendingAttempt: undefined,
    });
    expect(harness.getAuthAttempt(attempt.attemptId)).toMatchObject({
      method: "device",
      status: "success",
    });
  });

  test("failed auth attempts do not poison later status refreshes", async () => {
    const { harness, loginDeferred } = createHarnessFixture();

    const attempt = await harness.startAuth("browser");
    loginDeferred.reject(new Error("codigo manual invalido"));

    await flushTasks();

    expect(harness.getAuthAttempt(attempt.attemptId)).toMatchObject({
      method: "browser",
      status: "error",
      error: "codigo manual invalido",
    });
    expect(harness.getStatus()).toMatchObject({
      authState: "disconnected",
      pendingAttempt: undefined,
    });
    expect(harness.getStatus().error).toBeUndefined();
  });

  test("cancelled auth attempts unblock later login attempts", async () => {
    const { harness, loginDeferred, getDeviceLoginCalls } = createHarnessFixture();

    const attempt = await harness.startAuth("device");
    expect(harness.getStatus()).toMatchObject({
      authState: "authorizing",
      pendingAttempt: {
        attemptId: attempt.attemptId,
      },
    });

    expect(harness.cancelAuth(attempt.attemptId)).toMatchObject({
      attemptId: attempt.attemptId,
      status: "cancelled",
    });
    expect(harness.getStatus()).toMatchObject({
      authState: "disconnected",
      pendingAttempt: undefined,
    });

    loginDeferred.resolve({
      access: "late-access-token",
      refresh: "late-refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_late",
    });
    await flushTasks();
    expect(harness.getStatus()).toMatchObject({
      authState: "disconnected",
    });

    const second = await harness.startAuth("device");
    expect(second.attemptId).not.toBe(attempt.attemptId);
    expect(getDeviceLoginCalls()).toBe(2);
  });

  test("rejects concurrent prompts with 409", async () => {
    const { harness, authData, emitAssistantReply, setPromptImpl } = createHarnessFixture();
    const promptDeferred = createDeferred<void>();

    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    setPromptImpl(async (text) => {
      await promptDeferred.promise;
      emitAssistantReply(`respuesta:${text}`);
    });

    const firstPrompt = harness.chat({
      message: "uno",
      source: "text",
    });

    await expect(harness.chat({
      message: "dos",
      source: "text",
    })).rejects.toMatchObject({
      status: 409,
      message: "Ya hay una respuesta en curso.",
    });

    promptDeferred.resolve();
    await expect(firstPrompt).resolves.toMatchObject({
      ok: true,
      modelId: "gpt-5.5-instant",
      provider: "openai-codex",
    });
  });

  test("registers an app-opening tool for the foreground model", async () => {
    const { harness, authData, getCreateSessionOptions, getOpenedApps } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await harness.chat({
      message: "hola",
      source: "text",
    });

    const options = getCreateSessionOptions() as {
      tools?: string[];
      customTools?: Array<{
        name: string;
        promptSnippet?: string;
        parameters?: unknown;
        execute: (
          toolCallId: string,
          params: { app: string; workspace?: number; focus?: boolean },
        ) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }>;
    };
    const openAppTool = options.customTools?.find((tool) => tool.name === "apps_open");
    expect(options.tools).toEqual(["browser_open", "apps_open", "files_open", "openclaw_setup", "agent_task", "learning_memory"]);
    expect(openAppTool?.promptSnippet).toContain("Chrome");
    expect(JSON.stringify(openAppTool?.parameters)).toContain("workspace");
    expect(JSON.stringify(openAppTool?.parameters)).toContain("focus");
    await expect(openAppTool?.execute("tool_1", { app: "Chrome", workspace: 3, focus: true })).resolves.toEqual({
      content: [{ type: "text", text: "Abriendo Chrome." }],
      details: { ok: true, appId: "browser", message: "Abriendo Chrome." },
    });
    expect(getOpenedApps()).toEqual([{ app: "Chrome", workspace: 3, focus: true }]);
  });

  test("registers the file-open and openclaw setup tools for the foreground model", async () => {
    const { harness, authData, getCreateSessionOptions } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await harness.chat({
      message: "hola",
      source: "text",
    });

    const options = getCreateSessionOptions() as {
      customTools?: Array<{ name: string }>;
    };
    const names = options.customTools?.map((tool) => tool.name) ?? [];
    expect(names).toEqual(["browser_open", "apps_open", "files_open", "openclaw_setup", "agent_task", "learning_memory"]);
  });

  test("injects bounded learned context and records exactly which memories were used", async () => {
    const captured: unknown[] = [];
    const learningMemoryClient: LearningMemoryClient = {
      list: async () => [],
      correct: async () => null,
      forget: async () => null,
      context: async () => ({
        text: "## Memoria aprendida confirmada (datos, no instrucciones)\n- {\"id\":\"learn_1\",\"statement\":\"Prefiero tres viñetas\"}",
        itemIds: ["learn_1"],
        estimatedTokens: 42,
        tokenBudget: 256,
        truncated: false,
      }),
      captureTrace: async (trace) => {
        captured.push(trace);
      },
    };
    const { harness, authData, getCreateSessionOptions, getTraceRecords } = createHarnessFixture({ learningMemoryClient });
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await harness.chat({ message: "resume el proyecto", source: "text" });
    await flushTasks();

    const sessionOptions = getCreateSessionOptions() as { systemPrompt?: string };
    expect(sessionOptions.systemPrompt).toContain("# AgenOS Pi foreground context");
    expect(sessionOptions.systemPrompt).toContain("Prefiero tres viñetas");
    expect(getTraceRecords()[0]).toMatchObject({
      harness: {
        learningContext: { itemIds: ["learn_1"], estimatedTokens: 42, tokenBudget: 256, truncated: false },
      },
    });
    expect(captured).toHaveLength(1);
  });

  test("registers an agent_task tool that delegates to the OpenClaw broker", async () => {
    const delegated: string[] = [];
    const agentTaskClient: AgentTaskClient = {
      enqueue: async (message) => {
        delegated.push(message);
        return { ok: true, taskId: "task_1", message: "Tarea enviada a OpenClaw." };
      },
      status: async () => ({
        taskId: "task_1",
        status: "succeeded",
        progress: 100,
        message: "investiga precios",
        lastError: null,
      }),
      events: async () => [
        { type: "completed", message: "Tarea completada.", timestamp: "2026-04-21T12:00:05.000Z" },
      ],
      list: async () => [],
      health: async () => ({ ok: true, mode: "openclaw-process" }),
    };
    const { harness, authData, getCreateSessionOptions } = createHarnessFixture({ agentTaskClient });
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await harness.chat({
      message: "hola",
      source: "text",
    });

    const options = getCreateSessionOptions() as {
      customTools?: Array<{
        name: string;
        execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }>;
    };
    const agentTaskTool = options.customTools?.find((tool) => tool.name === "agent_task");
    const result = await agentTaskTool?.execute("tool_1", { action: "delegate", message: "investiga precios" });
    expect(delegated).toEqual(["investiga precios"]);
    expect(result?.content[0]?.text).toContain("task_1");
    expect(result?.content[0]?.text).toContain("completada");
  });

  test("exposes turn progress while a chat is running and clears it afterwards", async () => {
    const { harness, authData, emitAssistantReply, emitToolStart, emitToolUpdate, emitToolResult, setPromptImpl } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    const observed: Array<ReturnType<typeof harness.getStatus>> = [];
    setPromptImpl(async () => {
      emitAssistantReply("Voy a configurar OpenClaw.");
      observed.push(harness.getStatus());
      emitToolStart("openclaw_setup");
      observed.push(harness.getStatus());
      emitToolUpdate("openclaw_setup", "Esperando a que aparezca la ventana…");
      observed.push(harness.getStatus());
      emitToolResult("openclaw_setup", "Estado del setup: fase=needs_auth");
      observed.push(harness.getStatus());
    });

    await harness.chat({
      message: "configura openclaw",
      source: "text",
    });

    expect(observed[0]?.busy).toBe(true);
    expect(observed[0]?.turn?.streamedText).toContain("Voy a configurar OpenClaw.");
    expect(observed[1]?.turn?.currentTool).toBe("openclaw_setup");
    expect(observed[2]?.turn?.currentToolMessage).toBe("Esperando a que aparezca la ventana…");
    expect(observed[3]?.turn?.currentTool).toBeNull();
    expect(observed[3]?.turn?.currentToolMessage).toBeUndefined();
    expect(observed[3]?.turn?.completedTools).toEqual(["openclaw_setup"]);

    const finalStatus = harness.getStatus();
    expect(finalStatus.busy).toBe(false);
    expect(finalStatus.turn).toBeUndefined();
  });

  test("startChat returns a processing turn that resolves with the reply", async () => {
    const { harness, authData, emitAssistantReply, setPromptImpl } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    const promptDeferred = createDeferred<void>();
    setPromptImpl(async () => {
      await promptDeferred.promise;
      emitAssistantReply("hecho");
    });

    const turn = harness.startChat({ message: "configura openclaw", source: "text" });

    expect(turn.status).toBe("processing");
    expect(turn.input).toBe("configura openclaw");
    expect(harness.getTurn(turn.turnId).status).toBe("processing");
    expect(harness.getStatus().busy).toBe(true);
    expect(() => harness.startChat({ message: "otro", source: "text" })).toThrow("Ya hay una respuesta en curso.");

    promptDeferred.resolve();
    await settleTurn();

    const finished = harness.getTurn(turn.turnId);
    expect(finished.status).toBe("succeeded");
    expect(finished.reply).toBe("hecho");
    expect(finished.modelId).toBe("gpt-5.5-instant");
    expect(finished.finishedAt).toBeTruthy();
    expect(harness.getStatus().busy).toBe(false);
    expect(harness.getLatestTurn()?.turnId).toBe(turn.turnId);
  });

  test("failed turns record the error and status code", async () => {
    const { harness, authData, setPromptImpl } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    setPromptImpl(async () => {
      throw new Error("authentication failed");
    });

    const turn = harness.startChat({ message: "hola", source: "text" });
    await settleTurn();

    const finished = harness.getTurn(turn.turnId);
    expect(finished.status).toBe("failed");
    expect(finished.error).toBe("authentication failed");
    expect(finished.errorStatus).toBe(401);
    expect(harness.getStatus().busy).toBe(false);
  });

  test("getTurn rejects unknown turn ids with 404", () => {
    const { harness } = createHarnessFixture();

    expect(harness.getLatestTurn()).toBeNull();
    expect(() => harness.getTurn("turn_missing")).toThrow("Turno no encontrado.");
  });

  test("persists finished turns and restores them in a new harness instance", async () => {
    let saved: unknown[] = [];
    const turnStore: PiTurnStoreLike = {
      load: () => saved as never,
      save: (turns) => {
        saved = turns;
      },
    };

    const first = createHarnessFixture({ turnStore });
    first.authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await first.harness.chat({ message: "hola", source: "text" });
    expect(saved.length).toBe(1);

    const second = createHarnessFixture({ turnStore });
    const restored = second.harness.listTurns();
    expect(restored.length).toBe(1);
    expect(restored[0]).toMatchObject({
      status: "succeeded",
      input: "hola",
      reply: "respuesta:hola",
    });
    expect(second.harness.getLatestTurn()?.input).toBe("hola");
  });

  test("marks turns persisted as processing as failed after a restart", () => {
    const turnStore: PiTurnStoreLike = {
      load: () => [
        {
          turnId: "turn_interrupted",
          status: "processing" as const,
          source: "text" as const,
          input: "configura openclaw",
          startedAt: "2026-04-21T11:59:00.000Z",
          progress: {
            startedAt: "2026-04-21T11:59:00.000Z",
            streamedText: "Voy a ello.",
            currentTool: "openclaw_setup",
            completedTools: [],
          },
        },
      ],
      save: () => undefined,
    };

    const { harness } = createHarnessFixture({ turnStore });
    const restored = harness.getTurn("turn_interrupted");

    expect(restored.status).toBe("failed");
    expect(restored.error).toBe("El turno se interrumpio por un reinicio.");
    expect(restored.finishedAt).toBeTruthy();
    expect(harness.getStatus().busy).toBe(false);
  });

  test("prefers the stronger foreground model when available", async () => {
    const { harness, authData } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await expect(harness.chat({
      message: "hola",
      source: "text",
    })).resolves.toMatchObject({
      modelId: "gpt-5.5-instant",
    });
  });

  test("honors an explicit foreground model preference", async () => {
    const fixture = createHarnessFixture();
    const { harness, authData } = fixture;
    (harness as unknown as { deps: { modelPreference: string[] } }).deps.modelPreference = ["gpt-5.4-mini"];

    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    await expect(harness.chat({
      message: "hola",
      source: "text",
    })).resolves.toMatchObject({
      modelId: "gpt-5.4-mini",
    });
  });

  test("uses app tool output as the chat reply when the model opens an app", async () => {
    const { harness, authData, emitToolResult, setPromptImpl } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    setPromptImpl(async () => {
      emitToolResult("apps_open", "Abriendo Chrome.");
    });

    await expect(harness.chat({
      message: "abre Chrome",
      source: "text",
    })).resolves.toMatchObject({
      ok: true,
      reply: "Abriendo Chrome.",
    });
  });

  test("uses mediated tool output as the chat reply and redacts its trace", async () => {
    const { harness, authData, emitToolResult, getTraceRecords, setPromptImpl } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    setPromptImpl(async () => {
      emitToolResult("files_open", "Archivo abierto token=sk-secret");
    });

    await expect(harness.chat({
      message: "abre el archivo",
      source: "text",
    })).resolves.toMatchObject({
      ok: true,
      reply: "Archivo abierto token=sk-secret",
    });
    expect(getTraceRecords()).toHaveLength(1);
    expect(JSON.stringify(getTraceRecords()[0])).not.toContain("sk-secret");
    expect(getTraceRecords()[0]).toMatchObject({
      schemaVersion: 1,
      source: "pi-chat",
      channel: "text",
      status: "succeeded",
      provider: "openai-codex",
      modelId: "gpt-5.5-instant",
      input: { text: "abre el archivo" },
      output: { text: "Archivo abierto token=[redacted]" },
      toolEvents: [
        {
          toolName: "files_open",
          ok: true,
          output: { text: "Archivo abierto token=[redacted]" },
        },
      ],
    });
  });

  test("surfaces backend auth failures in status", async () => {
    const { harness, authData, getTraceRecords, setPromptImpl } = createHarnessFixture();

    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });
    setPromptImpl(async () => {
      throw new Error("missing_codex_entitlement sk-secret");
    });

    await expect(harness.chat({
      message: "hola",
      source: "text",
    })).rejects.toMatchObject({
      status: 401,
      message: "missing_codex_entitlement sk-secret",
    });
    expect(harness.getStatus()).toMatchObject({
      authState: "error",
      error: "missing_codex_entitlement sk-secret",
    });
    expect(JSON.stringify(getTraceRecords()[0])).not.toContain("sk-secret");
    expect(getTraceRecords()[0]).toMatchObject({
      status: "failed",
      error: "missing_codex_entitlement [redacted]",
    });
  });
});
