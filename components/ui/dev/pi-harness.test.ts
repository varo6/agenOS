import { describe, expect, test } from "bun:test";

import { createPiHarness, resolvePiHarnessPaths } from "./pi-harness";

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
  const openedApps: string[] = [];

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
      openApp: async (app: string) => {
        openedApps.push(app);
        return { ok: true, appId: "browser", message: `Abriendo ${app}.` };
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
  test("resolves packaged Codex state paths from AGENOS_PI_AGENT_DIR", () => {
    expect(resolvePiHarnessPaths({
      AGENOS_PI_AGENT_DIR: "/home/agenos/.agenos/ui-dev/pi",
    }, "/unused")).toEqual({
      agentDir: "/home/agenos/.agenos/ui-dev/pi",
      authPath: "/home/agenos/.agenos/ui-dev/pi/auth.json",
      codexDeviceDir: "/home/agenos/.agenos/ui-dev/pi/codex-device",
    });
  });

  test("defaults Codex state paths under the current home directory", () => {
    expect(resolvePiHarnessPaths({}, "/home/agenos")).toEqual({
      agentDir: "/home/agenos/.agenos/ui-dev/pi",
      authPath: "/home/agenos/.agenos/ui-dev/pi/auth.json",
      codexDeviceDir: "/home/agenos/.agenos/ui-dev/pi/codex-device",
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
        execute: (toolCallId: string, params: { app: string }) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }>;
    };
    const openAppTool = options.customTools?.find((tool) => tool.name === "apps_open");
    expect(options.tools).toEqual(["apps_open"]);
    expect(openAppTool?.promptSnippet).toContain("Chrome");
    await expect(openAppTool?.execute("tool_1", { app: "Chrome" })).resolves.toEqual({
      content: [{ type: "text", text: "Abriendo Chrome." }],
      details: { ok: true, appId: "browser", message: "Abriendo Chrome." },
    });
    expect(getOpenedApps()).toEqual(["Chrome"]);
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

  test("surfaces backend auth failures in status", async () => {
    const { harness, authData, setPromptImpl } = createHarnessFixture();

    authData.set("openai-codex", {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.parse("2026-04-22T12:00:00.000Z"),
      accountId: "acct_123",
    });
    setPromptImpl(async () => {
      throw new Error("missing_codex_entitlement");
    });

    await expect(harness.chat({
      message: "hola",
      source: "text",
    })).rejects.toMatchObject({
      status: 401,
      message: "missing_codex_entitlement",
    });
    expect(harness.getStatus()).toMatchObject({
      authState: "error",
      error: "missing_codex_entitlement",
    });
  });
});
