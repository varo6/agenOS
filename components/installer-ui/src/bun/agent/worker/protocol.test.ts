import { describe, expect, test } from "bun:test";
import { createProtocolEnvelope, isProtocolEnvelope } from "./protocol";

describe("worker protocol envelopes", () => {
  test("creates schema-versioned envelopes with correlation ids", () => {
    const envelope = createProtocolEnvelope({
      type: "worker.task.queued",
      correlationId: "corr_test",
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      payload: { taskId: "task_test" },
    });

    expect(envelope).toEqual({
      schemaVersion: 1,
      type: "worker.task.queued",
      correlationId: "corr_test",
      timestamp: "2026-05-16T12:00:00.000Z",
      payload: { taskId: "task_test" },
    });
    expect(isProtocolEnvelope(envelope)).toBe(true);
  });

  test("rejects records without schemaVersion or correlationId", () => {
    expect(isProtocolEnvelope({ type: "worker.task.queued", payload: {} })).toBe(false);
    expect(isProtocolEnvelope({ schemaVersion: 2, type: "future", correlationId: "corr", timestamp: "now", payload: {} })).toBe(false);
  });
});
