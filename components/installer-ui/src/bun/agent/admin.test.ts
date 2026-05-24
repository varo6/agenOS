import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
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
    });

    await expect(service.status()).resolves.toMatchObject({
      ok: true,
      readiness: "ready",
      worker: { mode: "agenos-bun-worker", serviceActive: true },
      config: { stateDir: rootDir, apiAuth: { configured: true } },
    });
  });

  test("config writes and restart require confirmation", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const service = createAgentAdminService({
      stateDir: rootDir,
      worker: { health: async () => ({ ok: true, mode: "local-simulated", serviceActive: false }) } as never,
      confirmations: {
        create: (request) => ({ confirmationId: `conf_${request.tool}`, status: "pending" }),
      } as never,
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
  });

  test("test connection reports setup needs without failing runtime", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-admin-"));
    const service = createAgentAdminService({
      stateDir: rootDir,
      worker: { health: async () => ({ ok: true, mode: "agenos-bun-worker", serviceActive: true }) } as never,
    });

    await expect(service.testConnection("ui")).resolves.toMatchObject({
      ok: false,
      status: 503,
      readiness: "needs_setup",
    });
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
