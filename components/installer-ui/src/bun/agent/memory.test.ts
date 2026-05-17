import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "./memory";

describe("agent memory store", () => {
  test("creates default memory files and reads empty namespaces", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-memory-"));
    const store = createMemoryStore({ rootDir: root, now: () => new Date("2026-05-15T00:00:00.000Z") });

    expect(store.read("contacts")).toEqual({ namespace: "contacts", content: "" });
    expect(readFileSync(join(root, "contacts.md"), "utf8")).toBe("");
    expect(readFileSync(join(root, "preferences.md"), "utf8")).toBe("");
    expect(readFileSync(join(root, "facts.md"), "utf8")).toBe("");
  });

  test("appends explicit contact memory and logs an event", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-memory-"));
    const store = createMemoryStore({ rootDir: root, now: () => new Date("2026-05-15T10:11:12.000Z") });

    const result = store.append("contacts", "Pablo Lopez es mi profesor. Email: pablo@example.com", "ui");

    expect(result.ok).toBe(true);
    expect(store.read("contacts").content).toContain("Pablo Lopez es mi profesor");
    const event = JSON.parse(readFileSync(join(root, "events.ndjson"), "utf8").trim());
    expect(event).toMatchObject({
      timestamp: "2026-05-15T10:11:12.000Z",
      namespace: "contacts",
      source: "ui",
      action: "memory.append",
    });
  });

  test("records worker task metadata in memory audit events", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-memory-"));
    const store = createMemoryStore({ rootDir: root, now: () => new Date("2026-05-16T14:00:00.000Z") });

    const result = store.append("facts", "Pablo Lopez es mi profesor", {
      source: "openclaw",
      taskId: "task_test",
      correlationId: "corr_memory_test",
      confirmationId: "conf_test",
    });

    expect(result.ok).toBe(true);
    const event = JSON.parse(readFileSync(join(root, "events.ndjson"), "utf8").trim());
    expect(event).toMatchObject({
      schemaVersion: 1,
      action: "memory.append",
      namespace: "facts",
      source: "openclaw",
      taskId: "task_test",
      correlationId: "corr_memory_test",
      confirmationId: "conf_test",
    });
  });
});
