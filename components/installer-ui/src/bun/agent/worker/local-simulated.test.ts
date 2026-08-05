import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSimulatedWorkerAdapter } from "./local-simulated";

describe("local simulated worker adapter", () => {
  test("reports simulated health through the worker contract", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-"));
    const adapter = createLocalSimulatedWorkerAdapter({ rootDir });

    await expect(adapter.health()).resolves.toEqual({
      schemaVersion: 1,
      ok: false,
      mode: "local-simulated",
      serviceActive: false,
      version: "local-simulated",
      stateDir: rootDir,
      queueDepth: 0,
      degradedReason: expect.stringContaining("No hay un worker real disponible"),
      lastHeartbeatAt: null,
      lastHeartbeatCorrelationId: null,
      lastError: expect.stringContaining("No hay un worker real disponible"),
      lastErrorCorrelationId: expect.stringMatching(/^corr_/),
      counters: {
        accepted: 0,
        confirmed: 0,
        denied: 0,
        failed: 0,
        retried: 0,
      },
    });
  });

  test("rejects delegation honestly without persisting an immortal queued task", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-"));
    const adapter = createLocalSimulatedWorkerAdapter({
      rootDir,
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      idFactory: () => "task_test",
      correlationIdFactory: () => "corr_task_test",
    });

    const queued = await adapter.enqueue({ message: "prepara un email", source: "ui" });

    expect(queued).toEqual({
      ok: false,
      message: expect.stringContaining("Configura OpenClaw"),
    });
    await expect(adapter.status("task_test")).resolves.toBeNull();
    await expect(adapter.events("task_test")).resolves.toEqual([]);
    expect(existsSync(join(rootDir, "outbox.ndjson"))).toBe(false);
  });
});
