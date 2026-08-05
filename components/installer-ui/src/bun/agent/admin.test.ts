import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentAdminService } from "./admin";

describe("agent admin service", () => {
  test("returns backend status with redacted config", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const service = createAgentAdminService({
      stateDir: rootDir,
      env: { AGENOS_OPENCLAW_API_KEY: "secret" },
      config: {
        schemaVersion: 1,
        mode: "auto",
        provider: "openai",
        model: "gpt-5.4-mini",
        apiAuth: { type: "env", envVar: "AGENOS_OPENCLAW_API_KEY" },
        stateDir: rootDir,
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
      worker: {
        health: async () => ({
          ok: true,
          mode: "agenos-bun-worker",
          serviceActive: true,
          version: "0.1.0",
          stateDir: rootDir,
          queueDepth: 0,
          lastError: null,
        }),
      } as never,
      setup: {
        status: async () => ({ ok: true, phase: "ready" }),
      } as never,
    });

    await expect(service.status()).resolves.toMatchObject({
      ok: true,
      readiness: "ready",
      worker: { mode: "agenos-bun-worker", serviceActive: true },
      config: { stateDir: rootDir, apiAuth: { configured: true } },
    });
  });

  test("persists confirmed config writes and invokes a real restart effect", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const userConfigPath = join(rootDir, "config.json");
    const restartCalls: string[] = [];
    const service = createAgentAdminService({
      stateDir: rootDir,
      env: { AGENOS_OPENCLAW_USER_CONFIG: userConfigPath },
      worker: { health: async () => ({ ok: true, mode: "local-simulated", serviceActive: false }) } as never,
      confirmations: {
        create: (request) => ({ confirmationId: `conf_${request.tool}`, status: "pending" }),
      } as never,
      restartWorker: async () => {
        restartCalls.push("restart");
        return { ok: true, message: "reiniciado" };
      },
    });

    await expect(service.writeConfig({ mode: "local-simulated" }, "ui")).resolves.toMatchObject({
      ok: false,
      decision: "confirm",
      confirmationId: "conf_admin.config.write",
    });
    await expect(service.restart("ui")).resolves.toMatchObject({
      ok: false,
      decision: "confirm",
      confirmationId: "conf_admin.service.restart",
    });

    await expect(service.executeConfirmed({
      schemaVersion: 1,
      confirmationId: "conf_config",
      correlationId: "corr_config",
      timestamp: "2026-08-13T10:00:00.000Z",
      action: "confirmation.confirm",
      status: "confirmed",
      source: "ui",
      tool: "admin.config.write",
      summary: "config",
      input: { mode: "local-simulated", explicitUserIntent: true },
      actor: "ui",
    })).resolves.toMatchObject({ ok: true, message: expect.stringContaining("guardada") });
    expect(JSON.parse(readFileSync(userConfigPath, "utf8"))).toMatchObject({ mode: "local-simulated" });
    await expect(service.readConfig()).resolves.toMatchObject({ mode: "local-simulated" });

    await expect(service.executeConfirmed({
      schemaVersion: 1,
      confirmationId: "conf_restart",
      correlationId: "corr_restart",
      timestamp: "2026-08-13T10:00:00.000Z",
      action: "confirmation.confirm",
      status: "confirmed",
      source: "ui",
      tool: "admin.service.restart",
      summary: "restart",
      input: {},
      actor: "ui",
    })).resolves.toEqual({ ok: true, message: "reiniciado" });
    expect(restartCalls).toEqual(["restart"]);
  });

  test("test connection fails honestly outside the real OpenClaw gateway", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const service = createAgentAdminService({
      stateDir: rootDir,
      worker: { health: async () => ({ ok: true, mode: "agenos-bun-worker", serviceActive: true }) } as never,
    });

    await expect(service.testConnection("ui")).resolves.toMatchObject({
      ok: false,
      status: 503,
      readiness: "degraded",
      message: expect.stringContaining("no esta disponible"),
    });
  });

  test("test connection uses the real OpenClaw health probe", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    let probes = 0;
    const service = createAgentAdminService({
      stateDir: rootDir,
      worker: {
        health: async () => {
          probes += 1;
          return { ok: true, mode: "openclaw-process", serviceActive: true };
        },
      } as never,
    });

    await expect(service.testConnection("ui")).resolves.toMatchObject({
      ok: true,
      status: 200,
      readiness: "ready",
      message: expect.stringContaining("verificada"),
    });
    expect(probes).toBe(1);
  });

  test("retry and confirmed clear delegate to the task queue and expose failures", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const calls: string[] = [];
    const taskQueue = {
      health: async () => ({ ok: true, mode: "openclaw-process", serviceActive: true }),
      events: async () => [],
      list: async () => [],
      retry: async (taskId: string) => {
        calls.push(`retry:${taskId}`);
        return { ok: true, taskId: "task_new", message: "reintentada" };
      },
      clear: async (taskId: string) => {
        calls.push(`clear:${taskId}`);
        return { ok: true, taskId, message: "eliminada" };
      },
    };
    const service = createAgentAdminService({ stateDir: rootDir, taskQueue: taskQueue as never });

    await expect(service.retryTask("task_old", "ui")).resolves.toMatchObject({ ok: true, taskId: "task_new" });
    await expect(service.executeConfirmed({
      schemaVersion: 1,
      confirmationId: "conf_clear",
      correlationId: "corr_clear",
      timestamp: "2026-08-13T10:00:00.000Z",
      action: "confirmation.confirm",
      status: "confirmed",
      source: "ui",
      tool: "admin.queue.clear",
      summary: "clear",
      input: { taskId: "task_old" },
      actor: "ui",
    })).resolves.toMatchObject({ ok: true, message: "eliminada" });
    expect(calls).toEqual(["retry:task_old", "clear:task_old"]);
  });

  test("includes setup actions in backend status", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const service = createAgentAdminService({
      stateDir: rootDir,
      env: { AGENOS_OPENCLAW_API_KEY: "secret" },
      config: {
        schemaVersion: 1,
        mode: "auto",
        provider: "openai",
        model: "openai/gpt-5.5",
        apiAuth: { type: "env", envVar: "AGENOS_OPENCLAW_API_KEY" },
        stateDir: rootDir,
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      },
      worker: { health: async () => ({ ok: true, mode: "agenos-bun-worker", serviceActive: true }) } as never,
      setup: {
        status: async () => ({
          ok: false,
          phase: "needs_auth",
          message: "Backend Codex auth is not configured.",
          actions: ["codex.login", "telegram.configure"],
          telegram: { enabled: false, tokenConfigured: false },
          codex: { configured: false, loginAvailable: true },
        }),
      } as never,
    });

    await expect(service.status()).resolves.toMatchObject({
      ok: false,
      readiness: "needs_setup",
      setup: {
        phase: "needs_auth",
        actions: ["codex.login", "telegram.configure"],
      },
      setupItems: [
        {
          id: "backend-codex-auth",
          action: "connect_backend_codex",
        },
        {
          id: "telegram-channel",
          action: "configure_telegram",
        },
      ],
    });
  });
});
