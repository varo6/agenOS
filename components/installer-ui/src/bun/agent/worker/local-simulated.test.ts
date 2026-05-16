import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSimulatedWorkerAdapter } from "./local-simulated";

describe("local simulated worker adapter", () => {
  test("reports simulated health through the worker contract", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-"));
    const adapter = createLocalSimulatedWorkerAdapter({ rootDir });

    await expect(adapter.health()).resolves.toEqual({
      schemaVersion: 1,
      ok: true,
      mode: "local-simulated",
      serviceActive: false,
      version: "local-simulated",
      stateDir: rootDir,
      queueDepth: 0,
      degradedReason: null,
      lastHeartbeatAt: null,
      lastHeartbeatCorrelationId: null,
      lastError: null,
      lastErrorCorrelationId: null,
      counters: {
        accepted: 0,
        confirmed: 0,
        denied: 0,
        failed: 0,
        retried: 0,
      },
    });
  });

  test("persists queued task status and progress events", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-"));
    const adapter = createLocalSimulatedWorkerAdapter({
      rootDir,
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      idFactory: () => "task_test",
      correlationIdFactory: () => "corr_task_test",
    });

    const queued = await adapter.enqueue({ message: "prepara un email", source: "ui" });

    expect(queued).toEqual({
      ok: true,
      taskId: "task_test",
      message: "Tarea enviada al worker de fondo.",
    });
    await expect(adapter.status("task_test")).resolves.toMatchObject({
      taskId: "task_test",
      status: "queued",
      message: "prepara un email",
    });
    await expect(adapter.events("task_test")).resolves.toEqual([
      {
        taskId: "task_test",
        schemaVersion: 1,
        correlationId: "corr_task_test",
        timestamp: "2026-05-16T12:00:00.000Z",
        type: "queued",
        message: "Tarea encolada.",
      },
    ]);

    const outbox = readFileSync(join(rootDir, "outbox.ndjson"), "utf8").trim();
    expect(JSON.parse(outbox)).toMatchObject({ taskId: "task_test", status: "queued" });
  });
});
