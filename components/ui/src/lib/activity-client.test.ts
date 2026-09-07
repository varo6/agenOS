import { afterEach, describe, expect, test } from "bun:test";
import { createActivityClient } from "./activity-client";

const originalWindow = globalThis.window;
afterEach(() => { Object.assign(globalThis, { window: originalWindow }); });

describe("activity client", () => {
  test("usa el puente de Electron sin peticiones HTTP del renderer", async () => {
    const calls: unknown[] = [];
    Object.assign(globalThis, { window: { agenosActivity: {
      isAvailable: () => true,
      listTasks: async () => [], listConfirmations: async () => [], taskEvents: async () => [],
      resolve: async (...args: unknown[]) => { calls.push(args); return { ok: true }; },
    } } });
    const client = createActivityClient();
    expect(await client.listTasks()).toEqual([]);
    expect(await client.resolve("c1", "deny")).toEqual({ ok: true });
    expect(calls).toEqual([["c1", "deny"]]);
  });

  test("codifica los IDs y envía intención explícita con sesión y límite de espera", async () => {
    const client = createActivityClient({ baseUrl: "http://localhost:4173", fetchImpl: (async (input, init) => {
      expect(String(input)).toBe("http://localhost:4173/api/agent/confirmations/c%2F1/confirm");
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(init?.body))).toEqual({ explicitUserIntent: true });
      return Response.json({ ok: true, message: "Enviado." });
    }) as typeof fetch });
    expect(await client.resolve("c/1", "confirm")).toEqual({ ok: true, message: "Enviado." });
  });

  test("propaga una decisión ya resuelta en lugar de fingir éxito", async () => {
    const client = createActivityClient({ fetchImpl: (async () => Response.json({ message: "Ya confirmada; no se repitió." }, { status: 409 })) as typeof fetch });
    await expect(client.resolve("c1", "confirm")).rejects.toThrow("Ya confirmada; no se repitió.");
  });
});
