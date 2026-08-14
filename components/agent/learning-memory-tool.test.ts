import { describe, expect, test } from "bun:test";

import { createHttpLearningMemoryClient, createLearningMemoryModelTool, type LearningMemoryClient } from "./learning-memory-tool";

describe("learning memory tool", () => {
  test("lists auditable IDs and supports correction and forgetting", async () => {
    const calls: unknown[] = [];
    const item = {
      itemId: "learn_1",
      kind: "preference" as const,
      statement: "Prefiero respuestas breves",
      confidence: 0.8,
      createdAt: "2026-08-13T10:00:00.000Z",
      updatedAt: "2026-08-13T10:00:00.000Z",
      expiresAt: "2026-11-11T10:00:00.000Z",
      sourceSignalIds: ["sig_1"],
      userEdited: false,
    };
    const client: LearningMemoryClient = {
      list: async () => [item],
      correct: async (itemId, statement) => {
        calls.push(["correct", itemId, statement]);
        return { ...item, statement, userEdited: true };
      },
      forget: async (itemId) => {
        calls.push(["forget", itemId]);
        return item;
      },
      context: async () => ({ text: "", itemIds: [], estimatedTokens: 0, tokenBudget: 256, truncated: false }),
      captureTrace: async () => {},
    };
    const tool = createLearningMemoryModelTool(client);

    expect((await tool.execute("tool_1", { action: "list" })).content[0]?.text).toContain("learn_1");
    expect((await tool.execute("tool_2", { action: "correct", itemId: "learn_1", statement: "Prefiero dos viñetas" })).content[0]?.text).toContain("dos viñetas");
    expect((await tool.execute("tool_3", { action: "forget", itemId: "learn_1" })).content[0]?.text).toContain("eliminada");
    expect(calls).toEqual([
      ["correct", "learn_1", "Prefiero dos viñetas"],
      ["forget", "learn_1"],
    ]);
  });

  test("HTTP client uses broker audit endpoints", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = createHttpLearningMemoryClient({
      baseUrl: "http://127.0.0.1:4173",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined });
        return new Response("[]", { status: 200 });
      },
    });

    await client.list();
    await client.forget("learn_1");

    expect(requests[0]).toMatchObject({ url: "http://127.0.0.1:4173/api/agent/learning/memories?includeDeleted=false", method: "GET" });
    expect(requests[1]).toMatchObject({ url: "http://127.0.0.1:4173/api/agent/learning/memories/learn_1", method: "DELETE" });
    expect(requests[1]?.body).toContain("explicitUserIntent");
  });
});
