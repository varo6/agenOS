import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
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
});
