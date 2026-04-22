import { describe, expect, test } from "bun:test";

import { createPiHarness } from "./pi-harness";

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
    createAgentSession: async () => ({ session }),
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
    getLoginCalls: () => loginCalls,
    getLoginOptions: () => loginOptions,
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
    const { harness, getLoginCalls } = createHarnessFixture();

    const first = await harness.startAuth();
    const second = await harness.startAuth();

    expect(first.attemptId).toBe(second.attemptId);
    expect(getLoginCalls()).toBe(1);
  });

  test("accepts manual code and transitions to connected", async () => {
    const { harness, getLoginOptions, loginDeferred } = createHarnessFixture();

    const attempt = await harness.startAuth();
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
      status: "success",
    });
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
      modelId: "gpt-5.4-mini",
      provider: "openai-codex",
    });
  });
});
