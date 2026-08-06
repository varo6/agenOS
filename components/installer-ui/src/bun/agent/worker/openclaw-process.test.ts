import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenClawProcessAdapter } from "./openclaw-process";
import type { OpenClawRuntime } from "./openclaw-runtime";

function fakeRuntime(overrides: Partial<OpenClawRuntime> = {}): OpenClawRuntime {
  return {
    resolveBinary: mock(() => "/fake/openclaw"),
    probeGateway: mock(async () => ({ ok: true, reachable: true, message: null })),
    version: mock(async () => "openclaw 2026.6.11"),
    chat: mock(async () => ({ ok: true, content: "respuesta", message: null })),
    startGateway: mock(() => ({ stop: () => {} })),
    ...overrides,
  } as unknown as OpenClawRuntime;
}

function temporaryStateDir(): string {
  return mkdtempSync(join(tmpdir(), "agenos-openclaw-process-"));
}

describe("openclaw process adapter", () => {
  test("returns unhealthy when the configured binary is missing", async () => {
    const adapter = createOpenClawProcessAdapter({
      binaryPath: "/missing/openclaw",
      stateDir: "/tmp/agenos-openclaw",
    });

    await expect(adapter.health()).resolves.toMatchObject({
      ok: false,
      mode: "openclaw-process",
      serviceActive: false,
      lastError: "OpenClaw binary not found: /missing/openclaw",
    });
  });

  test("reports active health and the runtime version when the gateway is healthy", async () => {
    const runtime = fakeRuntime();
    const adapter = createOpenClawProcessAdapter({ stateDir: temporaryStateDir(), runtime });

    await expect(adapter.health()).resolves.toMatchObject({
      ok: true,
      serviceActive: true,
      version: "openclaw 2026.6.11",
      degradedReason: null,
    });
    expect(runtime.version).toHaveBeenCalledTimes(1);
  });

  test("reports a degraded reason when the gateway probe fails", async () => {
    const runtime = fakeRuntime({
      probeGateway: mock(async () => ({ ok: false, reachable: true, message: "token rejected" })),
    });
    const adapter = createOpenClawProcessAdapter({ stateDir: temporaryStateDir(), runtime });

    await expect(adapter.health()).resolves.toMatchObject({
      ok: false,
      serviceActive: false,
      degradedReason: "token rejected",
      lastError: "token rejected",
    });
  });

  test("tests provider connectivity with a real minimal chat round trip", async () => {
    const runtime = fakeRuntime();
    const adapter = createOpenClawProcessAdapter({ stateDir: temporaryStateDir(), runtime });

    await expect(adapter.testConnection()).resolves.toEqual({
      ok: true,
      message: "Conexion real con el proveedor verificada mediante OpenClaw.",
    });
    expect(runtime.chat).toHaveBeenCalledWith(
      "Responde unicamente con OK para verificar la conexion del proveedor.",
      { timeoutMs: 15_000 },
    );
  });

  test("rejects enqueue when the gateway probe fails", async () => {
    const runtime = fakeRuntime({
      probeGateway: mock(async () => ({ ok: false, reachable: false, message: "gateway down" })),
    });
    const adapter = createOpenClawProcessAdapter({ stateDir: temporaryStateDir(), runtime });

    await expect(adapter.enqueue({ message: "hola", source: "ui" })).resolves.toEqual({
      ok: false,
      message: "gateway down",
    });
    expect(runtime.chat).not.toHaveBeenCalled();
  });

  test("stores successful tasks and exposes them through status, events, and list", async () => {
    const runtime = fakeRuntime({
      chat: mock(async () => ({ ok: true, content: "hola desde OpenClaw", message: null })),
    });
    const adapter = createOpenClawProcessAdapter({
      stateDir: temporaryStateDir(),
      runtime,
      idFactory: () => "task_success",
      correlationIdFactory: () => "corr_success",
      now: () => new Date("2026-07-02T10:00:00.000Z"),
    });

    const queued = await adapter.enqueue({ message: "saluda", source: "ui" });
    expect(queued).toMatchObject({ ok: true, taskId: "task_success", correlationId: "corr_success" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(adapter.status("task_success")).resolves.toMatchObject({
      taskId: "task_success",
      status: "succeeded",
      progress: 100,
      lastError: null,
    });
    await expect(adapter.events("task_success")).resolves.toEqual([
      expect.objectContaining({ type: "queued" }),
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({ type: "completed", message: "hola desde OpenClaw" }),
    ]);
    await expect(adapter.list()).resolves.toEqual([
      expect.objectContaining({ taskId: "task_success", status: "succeeded" }),
    ]);
  });

  test("injects broker-selected learned context into OpenClaw as system context", async () => {
    const runtime = fakeRuntime();
    const adapter = createOpenClawProcessAdapter({
      stateDir: temporaryStateDir(),
      runtime,
      learnedContextProvider: async () => "Memoria confirmada: respuestas breves",
    });

    await adapter.enqueue({ message: "resume el proyecto", source: "ui" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.chat).toHaveBeenCalledWith("resume el proyecto", {
      systemContext: "Memoria confirmada: respuestas breves",
    });
  });

  test("marks the task failed and records lastError when chat fails", async () => {
    const runtime = fakeRuntime({
      chat: mock(async () => ({ ok: false, content: null, message: "provider unavailable" })),
    });
    const adapter = createOpenClawProcessAdapter({
      stateDir: temporaryStateDir(),
      runtime,
      idFactory: () => "task_failed",
      correlationIdFactory: () => "corr_failed",
    });

    expect(await adapter.enqueue({ message: "saluda", source: "ui" })).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(adapter.status("task_failed")).resolves.toMatchObject({
      status: "failed",
      lastError: "provider unavailable",
    });
    await expect(adapter.events("task_failed")).resolves.toContainEqual(
      expect.objectContaining({ type: "failed", message: "provider unavailable" }),
    );
  });
});
