import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgenosWorkerDaemonAdapter } from "./agenos-worker-daemon";

describe("agenos bun worker daemon adapter", () => {
  test("uses the same task contract as the real backend fallback", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agenos-bun-worker-"));
    const adapter = createAgenosWorkerDaemonAdapter({
      stateDir,
      now: () => new Date("2026-05-16T12:30:00.000Z"),
      idFactory: () => "task_daemon",
      correlationIdFactory: () => "corr_daemon",
    });

    const queued = await adapter.enqueue({ message: "resume contacts", source: "ui" });

    expect(queued.taskId).toBe("task_daemon");
    expect(queued.ok).toBe(false);
    await expect(adapter.health()).resolves.toMatchObject({
      ok: true,
      mode: "agenos-bun-worker",
      serviceActive: true,
      stateDir,
      degradedReason: "Provider/auth is not configured.",
    });
    await expect(adapter.status("task_daemon")).resolves.toMatchObject({
      taskId: "task_daemon",
      correlationId: "corr_daemon",
      status: "failed",
      lastError: "Provider/auth is not configured.",
    });
    await expect(adapter.events("task_daemon")).resolves.toEqual([
      {
        schemaVersion: 1,
        taskId: "task_daemon",
        correlationId: "corr_daemon",
        timestamp: "2026-05-16T12:30:00.000Z",
        type: "queued",
        message: "Task accepted by AgenOS worker daemon.",
      },
      {
        schemaVersion: 1,
        taskId: "task_daemon",
        correlationId: "corr_daemon",
        timestamp: "2026-05-16T12:30:00.000Z",
        type: "progress",
        message: "Provider/auth is not configured. Configure provider/auth in the admin UI.",
        progress: 0,
      },
      {
        schemaVersion: 1,
        taskId: "task_daemon",
        correlationId: "corr_daemon",
        timestamp: "2026-05-16T12:30:00.000Z",
        type: "failed",
        message: "Provider/auth is not configured.",
        progress: 100,
      },
    ]);
  });

  test("executes planned tool calls and marks the task complete", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agenos-bun-worker-"));
    const calls: unknown[] = [];
    const adapter = createAgenosWorkerDaemonAdapter({
      stateDir,
      now: () => new Date("2026-05-16T12:30:00.000Z"),
      idFactory: () => "task_exec",
      correlationIdFactory: () => "corr_exec",
      config: {
        schemaVersion: 1,
        mode: "agenos-bun-worker",
        provider: "local",
        model: "planner",
        apiAuth: { type: "none" },
        stateDir,
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
      planner: {
        mode: "model-backed",
        plan: async () => ({
          ok: true,
          steps: [{ tool: "shell.exec", input: { command: "id" }, summary: "Inspect user id." }],
        }),
      },
      runToolCall: async (call) => {
        calls.push(call);
        return { ok: true, decision: "allow", message: "done" };
      },
    });

    await expect(adapter.enqueue({ message: "quien soy", source: "ui" })).resolves.toMatchObject({
      ok: true,
      taskId: "task_exec",
      correlationId: "corr_exec",
      message: "Task completed.",
    });
    expect(calls).toEqual([{ correlationId: "corr_exec", taskId: "task_exec", tool: "shell.exec", input: { command: "id" } }]);
    await expect(adapter.status("task_exec")).resolves.toMatchObject({
      status: "succeeded",
      progress: 100,
      lastError: null,
    });
    await expect(adapter.events("task_exec")).resolves.toMatchObject([
      { type: "queued" },
      { type: "started" },
      { type: "tool_request" },
      { type: "completed" },
    ]);
  });
});
