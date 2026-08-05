import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfirmationStore } from "./confirmations";

describe("confirmation store", () => {
  test("creates pending confirmation and audits confirm/deny decisions", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-confirmations-"));
    const store = createConfirmationStore({
      rootDir,
      now: () => new Date("2026-05-16T13:00:00.000Z"),
      idFactory: () => "conf_test",
    });

    const pending = store.create({
      source: "openclaw",
      taskId: "task_test",
      correlationId: "corr_confirm_test",
      tool: "memory.write",
      summary: "Guardar en facts: Pablo Lopez es mi profesor",
      input: { namespace: "facts", content: "Pablo Lopez es mi profesor" },
    });

    expect(pending).toMatchObject({
      schemaVersion: 1,
      confirmationId: "conf_test",
      correlationId: "corr_confirm_test",
      status: "pending",
    });
    expect(store.confirm("conf_test", "ui")).toMatchObject({ status: "confirmed" });
    expect(store.confirm("conf_test", "ui")).toMatchObject({ status: "confirmed" });

    const audit = readFileSync(join(rootDir, "confirmations.ndjson"), "utf8");
    expect(audit).toContain("\"action\":\"confirmation.confirm\"");
    expect(audit.trim().split("\n")).toHaveLength(2);
  });
});
