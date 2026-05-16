import { describe, expect, test } from "bun:test";
import { createObservabilityState } from "./observability";

describe("worker observability", () => {
  test("tracks heartbeat, degraded reason, and counters", () => {
    const state = createObservabilityState({ now: () => new Date("2026-05-16T12:00:00.000Z") });

    state.recordHeartbeat("corr_heartbeat");
    state.increment("accepted");
    state.setDegraded("provider auth missing", "corr_error");

    expect(state.snapshot()).toMatchObject({
      lastHeartbeatAt: "2026-05-16T12:00:00.000Z",
      lastHeartbeatCorrelationId: "corr_heartbeat",
      degradedReason: "provider auth missing",
      lastErrorCorrelationId: "corr_error",
      counters: { accepted: 1 },
    });
  });
});
