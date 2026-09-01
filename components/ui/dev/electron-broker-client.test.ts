import { describe, expect, test } from "bun:test";

import { BrokerApiError, createBrokerPiClient } from "../src/electron/broker-pi-client";

describe("Electron Pi broker client", () => {
  test("delegates Pi turns to the authenticated broker API", async () => {
    const calls: Array<{ url: string; method: string; authorization: string | null; body: string }> = [];
    const client = createBrokerPiClient({
      baseUrl: "http://127.0.0.1:4173",
      readToken: () => "ui-token",
      fetchImpl: (async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization"),
          body: String(init?.body ?? ""),
        });
        return new Response(JSON.stringify({
          turnId: "turn_broker",
          status: "processing",
          source: "text",
          input: "abre Fotos",
          startedAt: "2026-08-13T10:00:00.000Z",
          progress: { startedAt: "2026-08-13T10:00:00.000Z", streamedText: "", currentTool: null, completedTools: [] },
        }), { status: 202 });
      }) as typeof fetch,
    });

    await expect(client.startChat({ message: "abre Fotos", source: "text" })).resolves.toMatchObject({
      turnId: "turn_broker",
      status: "processing",
    });
    expect(calls).toEqual([{
      url: "http://127.0.0.1:4173/api/pi/turns",
      method: "POST",
      authorization: "Bearer ui-token",
      body: JSON.stringify({ message: "abre Fotos", source: "text" }),
    }]);
  });

  test("preserves broker policy status codes across IPC", async () => {
    const client = createBrokerPiClient({
      readToken: () => "ui-token",
      fetchImpl: (async () => new Response(JSON.stringify({ message: "Confirmacion requerida." }), { status: 409 })) as typeof fetch,
    });

    await expect(client.chat({ message: "borra todo", source: "text" })).rejects.toEqual(
      new BrokerApiError(409, "Confirmacion requerida."),
    );
  });

  test("cancels a Pi turn through the broker", async () => {
    let call: { url: string; method: string } | undefined;
    const client = createBrokerPiClient({
      readToken: () => "ui-token",
      fetchImpl: (async (input, init) => {
        call = { url: String(input), method: init?.method ?? "GET" };
        return new Response(JSON.stringify({ status: "cancelled" }), { status: 200 });
      }) as typeof fetch,
    });

    await expect(client.cancelTurn("turn/abc")).resolves.toMatchObject({ status: "cancelled" });
    expect(call).toEqual({
      url: "http://127.0.0.1:4173/api/pi/turns/turn%2Fabc/cancel",
      method: "POST",
    });
  });

  test("opens OAuth and external links through the broker instead of a local adapter", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const client = createBrokerPiClient({
      readToken: () => "ui-token",
      fetchImpl: (async (input, init) => {
        calls.push({ url: String(input), body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ ok: true, message: "Chromium abierto." }), { status: 202 });
      }) as typeof fetch,
    });

    await expect(client.openBrowserUrl("https://auth.example/device")).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual([{
      url: "http://127.0.0.1:4173/api/agent/browser/open-url",
      body: JSON.stringify({ url: "https://auth.example/device" }),
    }]);
  });
});
