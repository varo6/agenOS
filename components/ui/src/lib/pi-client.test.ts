import { afterEach, describe, expect, test } from "bun:test";

import { createPiClient, PiClientError } from "./pi-client";
import { PI_DEV_HARNESS_ORIGIN } from "./pi-types";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function setWindowOrigin(origin: string) {
  globalThis.window = {
    location: new URL(origin),
  } as Window & typeof globalThis;
}

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }

  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    delete globalThis.window;
  }
});

describe("createPiClient", () => {
  test("reads the harness status", async () => {
    setWindowOrigin(PI_DEV_HARNESS_ORIGIN);

    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        authState: "connected",
        providerName: "ChatGPT/Codex",
        modelId: "gpt-5.4-mini",
        busy: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = createPiClient();
    await expect(client.getStatus()).resolves.toEqual({
      authState: "connected",
      providerName: "ChatGPT/Codex",
      modelId: "gpt-5.4-mini",
      busy: false,
    });
    expect(requestedUrl).toBe(`${PI_DEV_HARNESS_ORIGIN}/api/pi/status`);
  });

  test("prefers the native Electron Pi bridge when available", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    };

    globalThis.window = {
      location: new URL("file:///opt/agenos/system/dist/index.html"),
      agenosPi: {
        isAvailable: () => true,
        getStatus: async () => ({
          authState: "connected",
          providerName: "ChatGPT/Codex",
          modelId: "gpt-5.4-mini",
          busy: false,
        }),
        startAuth: async () => {
          throw new Error("not used");
        },
        cancelAuth: async () => undefined,
        getAuthAttempt: async () => {
          throw new Error("not used");
        },
        submitManualCode: async () => {
          throw new Error("not used");
        },
        logout: async () => undefined,
        sendMessage: async () => {
          throw new Error("not used");
        },
      },
    } as Window & typeof globalThis;

    const client = createPiClient();
    await expect(client.getStatus()).resolves.toMatchObject({
      authState: "connected",
    });
    expect(fetchCalls).toBe(0);
  });

  test("starts the auth flow with POST", async () => {
    setWindowOrigin(PI_DEV_HARNESS_ORIGIN);

    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
      });

      return new Response(JSON.stringify({
        attemptId: "att_123",
        url: "https://auth.example",
        instructions: "Completa el login",
        expiresAt: "2026-04-21T00:10:00.000Z",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = createPiClient();
    await expect(client.startAuth()).resolves.toEqual({
      attemptId: "att_123",
      url: "https://auth.example",
      instructions: "Completa el login",
      expiresAt: "2026-04-21T00:10:00.000Z",
    });
    expect(requests).toEqual([{
      url: `${PI_DEV_HARNESS_ORIGIN}/api/pi/auth/start`,
      method: "POST",
    }]);
  });

  test("cancels the auth flow with POST", async () => {
    setWindowOrigin(PI_DEV_HARNESS_ORIGIN);

    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = createPiClient();
    await expect(client.cancelAuth("att_123")).resolves.toBeUndefined();
    expect(requests).toEqual([{
      url: `${PI_DEV_HARNESS_ORIGIN}/api/pi/auth/cancel`,
      method: "POST",
      body: { attemptId: "att_123" },
    }]);
  });

  test("sends chat messages", async () => {
    setWindowOrigin(PI_DEV_HARNESS_ORIGIN);

    let payload = "";
    globalThis.fetch = async (_input, init) => {
      payload = String(init?.body ?? "");
      return new Response(JSON.stringify({
        ok: true,
        reply: "hola",
        provider: "openai-codex",
        modelId: "gpt-5.4-mini",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = createPiClient();
    await expect(client.sendMessage("hola", "voice")).resolves.toEqual({
      ok: true,
      reply: "hola",
      provider: "openai-codex",
      modelId: "gpt-5.4-mini",
    });
    expect(JSON.parse(payload)).toEqual({
      message: "hola",
      source: "voice",
    });
  });

  test("surfaces HTTP errors from the harness", async () => {
    setWindowOrigin(PI_DEV_HARNESS_ORIGIN);

    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: false,
      message: "Conecta ChatGPT antes de enviar mensajes.",
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const client = createPiClient();
    await expect(client.getStatus()).rejects.toMatchObject({
      message: "Conecta ChatGPT antes de enviar mensajes.",
      status: 401,
    } satisfies Partial<PiClientError>);
  });

  test("uses the current HTTP origin outside the Vite harness", async () => {
    setWindowOrigin("http://127.0.0.1:3000");
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        authState: "disconnected",
        providerName: "ChatGPT/Codex",
        modelId: "gpt-5.4-mini",
        busy: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = createPiClient();

    await expect(client.getStatus()).resolves.toMatchObject({
      authState: "disconnected",
    });
    expect(requestedUrl).toBe("http://127.0.0.1:3000/api/pi/status");
  });

  test("uses the packaged API when loaded from a file origin", async () => {
    setWindowOrigin("file:///opt/agenos/installer/system-dist/index.html");

    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        authState: "connected",
        providerName: "ChatGPT/Codex",
        modelId: "gpt-5.4-mini",
        busy: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const client = createPiClient();
    await expect(client.getStatus()).resolves.toMatchObject({
      authState: "connected",
    });
    expect(requestedUrl).toBe("http://127.0.0.1:4173/api/pi/status");
  });
});
