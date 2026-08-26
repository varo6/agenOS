import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HarnessTraceRecord } from "../../../../agent/harness-trace";
import { createLearnedMemoryStore } from "./learned-memory";
import { createSelfImprovementLoop } from "./self-improvement";

function trace(input: Partial<HarnessTraceRecord> = {}): HarnessTraceRecord {
  return {
    schemaVersion: 1,
    traceId: "trace_1",
    timestamp: "2026-08-13T10:00:00.000Z",
    source: "pi-chat",
    channel: "text",
    status: "succeeded",
    durationMs: 100,
    harness: { promptHash: "prompt", tools: ["apps_open"] },
    input: { text: "Prefiero que abras Firefox", length: 27, truncated: false },
    output: { text: "Entendido", length: 9, truncated: false },
    toolEvents: [],
    ...input,
  };
}

describe("self improvement loop", () => {
  test("turns an explicit durable correction into a confirmation proposal", async () => {
    const memory = createLearnedMemoryStore({
      rootDir: mkdtempSync(join(tmpdir(), "agenos-learning-loop-")),
      now: () => new Date("2026-08-13T10:00:00.000Z"),
      signalIdFactory: () => "sig_generated",
    });
    const writes: unknown[] = [];
    const loop = createSelfImprovementLoop({
      memory,
      proposeMemoryWrite: async (input) => {
        writes.push(input);
        return { decision: "confirm", confirmationId: "conf_1" };
      },
    });

    const result = await loop.captureHarnessTrace(trace());

    expect(result.signals.map((signal) => signal.type)).toEqual(["turn_succeeded", "explicit_correction"]);
    expect(result.proposals).toHaveLength(1);
    expect(writes).toEqual([
      expect.objectContaining({
        namespace: "preferences",
        content: "Prefiero que abras Firefox",
        learned: expect.objectContaining({ kind: "preference", confidence: 0.75 }),
      }),
    ]);
    expect(memory.list()).toEqual([]);
  });

  test("captures successes and failures without inventing reusable knowledge", async () => {
    const memory = createLearnedMemoryStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-learning-loop-")) });
    const writes: unknown[] = [];
    const loop = createSelfImprovementLoop({
      memory,
      proposeMemoryWrite: async (input) => writes.push(input),
    });

    const result = await loop.captureHarnessTrace(trace({
      input: { text: "abre Chrome", length: 11, truncated: false },
      toolEvents: [
        { toolName: "apps_open", ok: true, timestamp: "2026-08-13T10:00:00.010Z" },
        { toolName: "bash", ok: false, timestamp: "2026-08-13T10:00:00.020Z", output: { text: "exit 1", length: 6, truncated: false } },
      ],
    }));

    expect(result.signals.map((signal) => signal.type)).toEqual(["turn_succeeded", "tool_succeeded", "tool_failed"]);
    expect(writes).toEqual([]);
  });

  test("records which confirmed memories were used by a turn", async () => {
    const memory = createLearnedMemoryStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-learning-loop-")) });
    const loop = createSelfImprovementLoop({ memory, proposeMemoryWrite: async () => undefined });

    const result = await loop.captureHarnessTrace(trace({
      input: { text: "resume el proyecto", length: 19, truncated: false },
      harness: {
        promptHash: "prompt-with-memory",
        tools: [],
        learningContext: { itemIds: ["learn_summary"], estimatedTokens: 82, tokenBudget: 256, truncated: false },
      },
    }));

    expect(result.signals).toContainEqual(expect.objectContaining({
      type: "learning_context_used",
      itemIds: ["learn_summary"],
      traceId: "trace_1",
    }));
    expect(result.proposals).toEqual([]);
  });

  test("distills denied actions but never recursively learns a denied memory write", async () => {
    const memory = createLearnedMemoryStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-learning-loop-")) });
    const writes: unknown[] = [];
    const loop = createSelfImprovementLoop({
      memory,
      proposeMemoryWrite: async (input) => writes.push(input),
    });
    const confirmation = {
      schemaVersion: 1 as const,
      confirmationId: "conf_delete",
      correlationId: "corr_delete",
      timestamp: "2026-08-13T10:00:00.000Z",
      action: "confirmation.deny" as const,
      status: "denied" as const,
      source: "openclaw" as const,
      tool: "shell.exec",
      summary: "Borrar Documentos",
      input: { command: "rm -rf ~/Documentos" },
      actor: "ui" as const,
    };

    await loop.captureDenied(confirmation);
    await loop.captureDenied({ ...confirmation, confirmationId: "conf_memory", tool: "memory.write" });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(expect.objectContaining({ content: expect.stringContaining("Borrar Documentos") }));
  });

  test("deduplicates proposals already pending confirmation", async () => {
    const memory = createLearnedMemoryStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-learning-loop-")) });
    const writes: unknown[] = [];
    const loop = createSelfImprovementLoop({
      memory,
      listConfirmations: () => [{
        schemaVersion: 1,
        confirmationId: "conf_existing",
        correlationId: "corr_existing",
        timestamp: "2026-08-13T10:00:00.000Z",
        action: "confirmation.create",
        status: "pending",
        source: "system",
        tool: "memory.write",
        summary: "Guardar preferencia",
        input: { learned: { statement: "Prefiero que abras Firefox" } },
      }],
      proposeMemoryWrite: async (input) => writes.push(input),
    });

    await loop.captureHarnessTrace(trace());
    expect(writes).toEqual([]);
  });
});
