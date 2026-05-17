import { describe, expect, test } from "bun:test";
import { migrateTaskRecord, migrateWorkerConfigRecord } from "./migrations";

describe("worker state migrations", () => {
  test("adds schemaVersion to legacy task records", () => {
    expect(migrateTaskRecord({
      taskId: "task_legacy",
      status: "queued",
      message: "legacy",
    })).toMatchObject({
      schemaVersion: 1,
      taskId: "task_legacy",
      status: "queued",
      message: "legacy",
    });
  });

  test("rejects unknown future config versions as degraded state", () => {
    expect(migrateWorkerConfigRecord({ schemaVersion: 99 })).toEqual({
      ok: false,
      degradedReason: "Unsupported worker config schemaVersion: 99",
    });
  });
});
