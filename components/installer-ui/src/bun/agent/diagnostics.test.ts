import { describe, expect, test } from "bun:test";
import { createDiagnosticsBundle } from "./diagnostics";

describe("agent diagnostics", () => {
  test("redacts secret values while keeping status and correlation context", async () => {
    const bundle = await createDiagnosticsBundle({
      workerHealth: {
        ok: false,
        mode: "agenos-bun-worker",
        serviceActive: true,
        version: "0.1.0",
        stateDir: "/home/agenos/.agenos/openclaw",
        queueDepth: 1,
        degradedReason: "Provider/auth is not configured.",
        lastHeartbeatAt: null,
        lastHeartbeatCorrelationId: null,
        lastError: "bad key sk-secret",
        lastErrorCorrelationId: "corr_failure",
        counters: { accepted: 1, confirmed: 0, denied: 0, failed: 1, retried: 0 },
      },
      config: {
        schemaVersion: 1,
        mode: "auto",
        provider: "openai",
        model: "gpt-5.4-mini",
        stateDir: "/home/agenos/.agenos/openclaw",
        apiAuth: { type: "env", envVar: "OPENAI_API_KEY", configured: true },
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
      taskEvents: [{ correlationId: "corr_task", message: "queued" }],
      memoryEvents: [{ correlationId: "corr_memory", action: "memory.append" }],
      policyRules: [{ ruleId: "agent.shell.deny", decision: "deny" }],
    });

    expect(bundle.worker.lastError).toBe("[redacted]");
    expect(JSON.stringify(bundle)).not.toContain("sk-secret");
    expect(bundle.correlationIds).toContain("corr_failure");
    expect(bundle.policyRules).toEqual([{ ruleId: "agent.shell.deny", decision: "deny" }]);
  });
});
