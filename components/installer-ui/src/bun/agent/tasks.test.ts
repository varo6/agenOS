import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskQueue } from "./tasks";

describe("agent task queue", () => {
  test("enqueues a simulated OpenClaw task", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-tasks-"));
    const queue = createTaskQueue({ rootDir: root, now: () => new Date("2026-05-15T12:00:00.000Z") });

    const result = queue.enqueue({ message: "prepara un email a Pablo", source: "ui" });

    expect(result.ok).toBe(true);
    expect(result.taskId).toMatch(/^task_/);
    const outbox = readFileSync(join(root, "outbox.ndjson"), "utf8").trim();
    expect(JSON.parse(outbox)).toMatchObject({
      timestamp: "2026-05-15T12:00:00.000Z",
      source: "ui",
      message: "prepara un email a Pablo",
      status: "queued",
    });
  });
});
