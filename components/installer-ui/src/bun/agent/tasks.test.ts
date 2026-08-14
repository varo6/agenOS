import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskQueue } from "./tasks";

describe("agent task queue", () => {
  test("reports unavailable simulated work without creating a queued record", async () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-tasks-"));
    const queue = createTaskQueue({
      rootDir: root,
      configMode: "local-simulated",
      now: () => new Date("2026-05-15T12:00:00.000Z"),
    });

    const result = await queue.enqueue({ message: "prepara un email a Pablo", source: "ui" });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("No hay un worker real disponible") });
    expect(existsSync(join(root, "outbox.ndjson"))).toBe(false);
  });

  test("reloads the broker adapter from the persisted config", async () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-task-reload-"));
    const configPath = join(root, "config.json");
    const queue = createTaskQueue({
      rootDir: root,
      env: { AGENOS_OPENCLAW_USER_CONFIG: configPath },
    });

    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, mode: "local-simulated" }));
    await expect(queue.reload()).resolves.toMatchObject({
      ok: true,
      health: { mode: "local-simulated", ok: false },
      message: expect.stringContaining("aplicada"),
    });
  });
});
