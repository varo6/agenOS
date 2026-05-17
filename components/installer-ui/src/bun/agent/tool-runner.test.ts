import { describe, expect, test } from "bun:test";
import { createToolRunner } from "./tool-runner";

describe("agent tool runner", () => {
  test("denies arbitrary shell from worker", async () => {
    const runner = createToolRunner();

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_test",
      tool: "shell.exec",
      input: { command: "id" },
    })).resolves.toEqual({
      ok: false,
      decision: "deny",
      message: "La ejecucion shell arbitraria no esta permitida en AgenOS.",
    });
  });

  test("turns background memory writes into confirmation requests", async () => {
    const created: unknown[] = [];
    const runner = createToolRunner({
      confirmations: {
        create: (request) => {
          created.push(request);
          return { confirmationId: "conf_test", status: "pending" };
        },
      } as never,
    });

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_test",
      tool: "memory.write",
      input: { namespace: "facts", content: "Pablo Lopez es mi profesor" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "confirm",
      confirmationId: "conf_test",
    });
    expect(created).toHaveLength(1);
  });
});
