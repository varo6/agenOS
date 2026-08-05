import { describe, expect, test } from "bun:test";
import { createPlannerAdapter } from "./planner";

describe("worker planner adapter", () => {
  test("runs disabled when provider auth is missing", async () => {
    const planner = createPlannerAdapter({ mode: "disabled" });

    expect(planner.mode).toBe("disabled");
    await expect(planner.plan({
      correlationId: "corr_plan",
      taskId: "task_plan",
      message: "resume contacts",
    })).resolves.toEqual({
      ok: false,
      steps: [],
      degradedReason: "El proveedor o la autenticacion no estan configurados.",
    });
  });

  test("delegates model backed planning behind the planner interface", async () => {
    const planner = createPlannerAdapter({
      mode: "model-backed",
      planWithModel: async (input) => ({
        ok: true,
        steps: [{ tool: "memory.read", input: { query: input.message }, summary: "Read relevant memory." }],
      }),
    });

    await expect(planner.plan({
      correlationId: "corr_plan",
      taskId: "task_plan",
      message: "resume contacts",
    })).resolves.toEqual({
      ok: true,
      steps: [{ tool: "memory.read", input: { query: "resume contacts" }, summary: "Read relevant memory." }],
    });
  });
});
