import { afterEach, describe, expect, test } from "bun:test";
import { createAgentAdminClient } from "./agent-admin-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  else delete globalThis.fetch;
});

describe("agent admin client", () => {
  test("reads admin status from the broker", async () => {
    const requests = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        ok: true,
        worker: { mode: "agenos-bun-worker", serviceActive: true, version: "0.1.0", queueDepth: 0, lastError: null },
        config: { mode: "auto", provider: "none", model: "none", stateDir: "/home/agenos/.agenos/openclaw" },
      }), { status: 200 });
    };

    const client = createAgentAdminClient({ baseUrl: "http://agent.test" });
    await expect(client.getStatus()).resolves.toMatchObject({
      ok: true,
      worker: { mode: "agenos-bun-worker", serviceActive: true },
    });
    expect(requests[0]).toBe("http://agent.test/api/agent/admin/status");
  });

  test("posts config changes only to the admin API", async () => {
    let body = "";
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: false, decision: "confirm", confirmationId: "conf_config" }), { status: 409 });
    };

    const client = createAgentAdminClient({ baseUrl: "http://agent.test" });
    await expect(client.updateConfig({ mode: "local-simulated" })).rejects.toThrow("confirm");
    expect(JSON.parse(body)).toEqual({ mode: "local-simulated", explicitUserIntent: true });
  });
});
