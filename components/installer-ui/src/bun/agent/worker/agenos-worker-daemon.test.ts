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
      status: "queued",
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
    ]);
  });
});
