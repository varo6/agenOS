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
});
