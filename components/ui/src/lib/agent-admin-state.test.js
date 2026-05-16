import { describe, expect, test } from "bun:test";
import { agentAdminReducer, createAgentAdminInitialState, deriveBackendReadiness } from "./agent-admin-state";

const status = {
  ok: true,
  readiness: "ready",
  setupItems: [],
  worker: {
    mode: "agenos-bun-worker",
    serviceActive: true,
    version: "0.1.0",
    queueDepth: 0,
    degradedReason: null,
    lastHeartbeatAt: null,
    lastError: null,
    lastErrorCorrelationId: null,
  },
  config: {
    mode: "auto",
    provider: "none",
    model: "none",
    stateDir: "/home/agenos/.agenos/openclaw",
    apiAuth: { type: "env", envVar: "AGENOS_OPENCLAW_API_KEY", configured: false },
    channels: { email: false, telegram: false, whatsapp: false },
    policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
  },
};

describe("agent admin state", () => {
  test("records loaded status and initializes config draft", () => {
    const state = agentAdminReducer(createAgentAdminInitialState(), {
      type: "status.loaded",
      status,
    });

    expect(state.status).toEqual(status);
    expect(state.configDraft).toEqual(status.config);
    expect(state.loading).toBe(false);
  });

  test("edits config draft without mutating loaded status", () => {
    const loaded = agentAdminReducer(createAgentAdminInitialState(), { type: "status.loaded", status });
    const state = agentAdminReducer(loaded, {
      type: "config.patch",
      patch: { mode: "local-simulated", provider: "openai" },
    });

    expect(state.configDraft).toMatchObject({ mode: "local-simulated", provider: "openai" });
    expect(state.status.config.mode).toBe("auto");
  });

  test("surfaces pending confirmation", () => {
    const state = agentAdminReducer(createAgentAdminInitialState(), {
      type: "confirmation.required",
      confirmationId: "conf_config",
      message: "confirm",
    });

    expect(state.pendingConfirmation).toEqual({ confirmationId: "conf_config", message: "confirm" });
  });

  test("records queue action success messages", () => {
    const state = agentAdminReducer(createAgentAdminInitialState(), {
      type: "task.action.completed",
      message: "Task retry requested.",
    });

    expect(state.lastMessage).toBe("Task retry requested.");
  });

  test("records diagnostics export result", () => {
    const diagnostics = { schemaVersion: 1, worker: { mode: "agenos-bun-worker" } };
    const state = agentAdminReducer(createAgentAdminInitialState(), {
      type: "diagnostics.exported",
      diagnostics,
    });

    expect(state.diagnostics).toBe(diagnostics);
  });
});

describe("agent backend readiness", () => {
  test("requires setup when provider auth is missing in real mode", () => {
    expect(deriveBackendReadiness({
      worker: {
        mode: "agenos-bun-worker",
        serviceActive: true,
        version: "0.1.0",
        queueDepth: 0,
        degradedReason: "provider auth missing",
        lastHeartbeatAt: "2026-05-16T12:00:00.000Z",
        lastError: null,
        lastErrorCorrelationId: null,
      },
      config: {
        mode: "auto",
        provider: "openai",
        model: "gpt-5.4-mini",
        stateDir: "/home/agenos/.agenos/openclaw",
        apiAuth: { type: "env", envVar: "OPENCLAW_API_KEY", configured: false },
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
    })).toMatchObject({
      readiness: "needs_setup",
      setupItems: [{ id: "provider-auth" }],
    });
  });

  test("treats local-simulated as usable degraded mode", () => {
    expect(deriveBackendReadiness({
      worker: {
        mode: "local-simulated",
        serviceActive: false,
        version: "local-simulated",
        queueDepth: 0,
        degradedReason: null,
        lastHeartbeatAt: null,
        lastError: null,
        lastErrorCorrelationId: null,
      },
      config: {
        mode: "local-simulated",
        provider: "none",
        model: "none",
        stateDir: "/home/agenos/.agenos/openclaw",
        apiAuth: { type: "none" },
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
    })).toMatchObject({
      readiness: "degraded",
      setupItems: [{ id: "local-simulated" }],
    });
  });
});
