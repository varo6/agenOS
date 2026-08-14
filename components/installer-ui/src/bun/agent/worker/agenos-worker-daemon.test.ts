import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgenosWorkerDaemonAdapter } from "./agenos-worker-daemon";

describe("agenos bun worker daemon adapter", () => {
  test("rejects tasks before enqueue when provider/auth and the real planner are unavailable", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agenos-bun-worker-"));
    const adapter = createAgenosWorkerDaemonAdapter({
      stateDir,
      now: () => new Date("2026-05-16T12:30:00.000Z"),
      idFactory: () => "task_daemon",
      correlationIdFactory: () => "corr_daemon",
    });

    const queued = await adapter.enqueue({ message: "resume contacts", source: "ui" });

    expect(queued).toMatchObject({
      ok: false,
      message: "El proveedor o la autenticacion no estan configurados.",
    });
    await expect(adapter.health()).resolves.toMatchObject({
      ok: false,
      mode: "agenos-bun-worker",
      serviceActive: true,
      stateDir,
      degradedReason: "El proveedor o la autenticacion no estan configurados.",
    });
    await expect(adapter.status("task_daemon")).resolves.toBeNull();
    await expect(adapter.events("task_daemon")).resolves.toEqual([]);
  });

  test("executes planned tool calls and marks the task complete", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agenos-bun-worker-"));
    const calls: unknown[] = [];
    const adapter = createAgenosWorkerDaemonAdapter({
      stateDir,
      now: () => new Date("2026-05-16T12:30:00.000Z"),
      idFactory: () => "task_exec",
      correlationIdFactory: () => "corr_exec",
      config: {
        schemaVersion: 1,
        mode: "agenos-bun-worker",
        provider: "local",
        model: "planner",
        apiAuth: { type: "none" },
        stateDir,
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
      planner: {
        mode: "model-backed",
        plan: async () => ({
          ok: true,
          steps: [{ tool: "shell.exec", input: { command: "id" }, summary: "Inspect user id." }],
        }),
      },
      runToolCall: async (call) => {
        calls.push(call);
        return { ok: true, decision: "allow", message: "done" };
      },
    });

    await expect(adapter.enqueue({ message: "quien soy", source: "ui" })).resolves.toMatchObject({
      ok: true,
      taskId: "task_exec",
      correlationId: "corr_exec",
      message: "Tarea completada.",
    });
    expect(calls).toEqual([{ correlationId: "corr_exec", taskId: "task_exec", tool: "shell.exec", input: { command: "id" } }]);
    await expect(adapter.status("task_exec")).resolves.toMatchObject({
      status: "succeeded",
      progress: 100,
      lastError: null,
    });
    await expect(adapter.events("task_exec")).resolves.toMatchObject([
      { type: "queued" },
      { type: "started" },
      { type: "tool_request" },
      { type: "completed" },
    ]);
  });

  test("persists a waiting continuation and resumes only the remaining steps", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agenos-bun-worker-"));
    const calls: string[] = [];
    const config = {
      schemaVersion: 1 as const,
      mode: "agenos-bun-worker" as const,
      provider: "local",
      model: "planner",
      apiAuth: { type: "none" as const },
      stateDir,
      channels: { email: false, telegram: false, whatsapp: false },
      policyDefaults: { memoryWrite: "confirm" as const, outboundSend: "confirm" as const },
    };
    const planner = {
      mode: "model-backed" as const,
      plan: async () => ({
        ok: true,
        steps: [
          { tool: "shell.exec", input: { command: "first" }, summary: "First" },
          { tool: "shell.exec", input: { command: "second" }, summary: "Second" },
        ],
      }),
    };
    const first = createAgenosWorkerDaemonAdapter({
      stateDir,
      idFactory: () => "task_resume",
      correlationIdFactory: () => "corr_resume",
      config,
      planner,
      runToolCall: async (call) => {
        calls.push((call.input as { command: string }).command);
        return { ok: false, decision: "confirm", message: "Confirma first" };
      },
    });

    await expect(first.enqueue({ message: "dos pasos", source: "ui" })).resolves.toMatchObject({ ok: true, taskId: "task_resume" });
    await expect(first.status("task_resume")).resolves.toMatchObject({ status: "waiting_confirmation" });

    const afterRestart = createAgenosWorkerDaemonAdapter({
      stateDir,
      config,
      planner,
      runToolCall: async (call) => {
        calls.push((call.input as { command: string }).command);
        return { ok: true, decision: "allow", message: "done" };
      },
    });
    await expect(afterRestart.resolveConfirmation("task_resume", { ok: true, message: "first ejecutado" })).resolves.toMatchObject({
      ok: true,
      message: "Tarea completada.",
    });
    expect(calls).toEqual(["first", "second"]);
    await expect(afterRestart.status("task_resume")).resolves.toMatchObject({ status: "succeeded", progress: 100 });
    await expect(afterRestart.events("task_resume")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "waiting_confirmation" }),
      expect.objectContaining({ type: "progress", message: "first ejecutado" }),
      expect.objectContaining({ type: "completed" }),
    ]));
  });

  test("retry creates a new execution and clear removes a terminal task", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "agenos-bun-worker-"));
    let nextId = 0;
    const adapter = createAgenosWorkerDaemonAdapter({
      stateDir,
      idFactory: () => `task_${++nextId}`,
      correlationIdFactory: () => `corr_${nextId}`,
      config: {
        schemaVersion: 1,
        mode: "agenos-bun-worker",
        provider: "local",
        model: "planner",
        apiAuth: { type: "none" },
        stateDir,
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
      planner: { mode: "model-backed", plan: async () => ({ ok: true, steps: [] }) },
    });

    await expect(adapter.enqueue({ message: "primera", source: "ui" })).resolves.toMatchObject({ ok: true, taskId: "task_1" });
    await expect(adapter.retry("task_1")).resolves.toMatchObject({ ok: true, taskId: "task_2" });
    await expect(adapter.status("task_2")).resolves.toMatchObject({ status: "succeeded", message: "primera" });
    await expect(adapter.clear("task_1")).resolves.toEqual({ ok: true, taskId: "task_1", message: "Tarea task_1 eliminada." });
    await expect(adapter.status("task_1")).resolves.toBeNull();
    await expect(adapter.events("task_1")).resolves.toEqual([]);
  });
});
