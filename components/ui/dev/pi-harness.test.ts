import { describe, expect, test } from "bun:test";

import { createPiHarness, PI_SYSTEM_PROMPT, resolvePiHarnessPaths } from "./pi-harness";

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

function createHarnessFixture() {
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
  const installedApps: string[] = [];
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
          { id: "gpt-5.4", provider: "openai-codex" },
          { id: "gpt-5.4-mini", provider: "openai-codex" },
        ];
      },
    },
    createSessionManager: () => ({ createdAt: now }),
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
      installApp: async (app: string) => {
        installedApps.push(app);
        return { ok: true, packageName: app, message: `Instalado ${app}.` };
      },
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
    getLoginCalls: () => loginCalls,
    getDeviceLoginCalls: () => deviceLoginCalls,
    getLoginOptions: () => loginOptions,
    getCreateSessionOptions: () => createSessionOptions,
    getOpenedApps: () => openedApps,
    getInstalledApps: () => installedApps,
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

describe("PiHarness", () => {
  test("loads the foreground system prompt from markdown context", () => {
    expect(PI_SYSTEM_PROMPT).toContain("# AgenOS Pi foreground context");
    expect(PI_SYSTEM_PROMPT).toContain("apps_open");
    expect(PI_SYSTEM_PROMPT).toContain("apps_install");
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
    });
  });

  test("defaults Codex state paths under the current home directory", () => {
    expect(resolvePiHarnessPaths({}, "/home/agenos")).toEqual({
      agentDir: "/home/agenos/.agenos/ui-dev/pi",
      authPath: "/home/agenos/.agenos/ui-dev/pi/auth.json",
      codexDeviceDir: "/home/agenos/.agenos/ui-dev/pi/codex-device",
      tracePath: "/home/agenos/.agenos/ui-dev/pi/traces/pi-chat.ndjson",
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
      modelId: "gpt-5.4",
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
    expect(options.tools).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls", "apps_open", "apps_install"]);
    expect(openAppTool?.promptSnippet).toContain("Chrome");
    expect(JSON.stringify(openAppTool?.parameters)).toContain("workspace");
    expect(JSON.stringify(openAppTool?.parameters)).toContain("focus");
    await expect(openAppTool?.execute("tool_1", { app: "Chrome", workspace: 3, focus: true })).resolves.toEqual({
      content: [{ type: "text", text: "Abriendo Chrome." }],
      details: { ok: true, appId: "browser", message: "Abriendo Chrome." },
    });
    expect(getOpenedApps()).toEqual([{ app: "Chrome", workspace: 3, focus: true }]);
  });

  test("registers an app-installing tool for the foreground model", async () => {
    const { harness, authData, getCreateSessionOptions, getInstalledApps } = createHarnessFixture();
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
        execute: (toolCallId: string, params: { package: string; openAfterInstall?: boolean }) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
      }>;
    };
    const installAppTool = options.customTools?.find((tool) => tool.name === "apps_install");
    await expect(installAppTool?.execute("tool_1", { package: "vlc", openAfterInstall: false })).resolves.toEqual({
      content: [{ type: "text", text: "Instalado vlc." }],
      details: { ok: true, packageName: "vlc", message: "Instalado vlc." },
    });
    expect(getInstalledApps()).toEqual(["vlc"]);
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
      modelId: "gpt-5.4",
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

  test("uses built-in tool output as the chat reply when bash returns output", async () => {
    const { harness, authData, emitToolResult, getTraceRecords, setPromptImpl } = createHarnessFixture();
    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });

    setPromptImpl(async () => {
      emitToolResult("bash", "uid=1000(agenos) token=sk-secret");
    });

    await expect(harness.chat({
      message: "ejecuta id",
      source: "text",
    })).resolves.toMatchObject({
      ok: true,
      reply: "uid=1000(agenos) token=sk-secret",
    });
    expect(getTraceRecords()).toHaveLength(1);
    expect(JSON.stringify(getTraceRecords()[0])).not.toContain("sk-secret");
    expect(getTraceRecords()[0]).toMatchObject({
      schemaVersion: 1,
      source: "pi-chat",
      channel: "text",
      status: "succeeded",
      provider: "openai-codex",
      modelId: "gpt-5.4",
      input: { text: "ejecuta id" },
      output: { text: "uid=1000(agenos) token=[redacted]" },
      toolEvents: [
        {
          toolName: "bash",
          ok: true,
          output: { text: "uid=1000(agenos) token=[redacted]" },
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
