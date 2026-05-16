import { describe, expect, test } from "bun:test";
import { agentAdminReducer, createAgentAdminInitialState } from "./agent-admin-state";

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
