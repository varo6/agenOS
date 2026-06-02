import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenClawSetupService } from "./setup";

describe("OpenClaw setup service", () => {
  test("records degraded setup state when OpenClaw is missing", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      openClawBinaryPath: join(rootDir, "missing-openclaw"),
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      now: () => new Date("2026-05-24T12:00:00.000Z"),
      correlationIdFactory: () => "corr_setup_missing",
    });

    const result = await service.run();

    expect(result).toMatchObject({
      ok: false,
      phase: "degraded",
      correlationId: "corr_setup_missing",
      openclaw: {
        installed: false,
        healthy: false,
      },
      codex: {
        configured: false,
        loginAvailable: false,
      },
      telegram: {
        enabled: false,
        tokenConfigured: false,
      },
    });
    expect(result.actions).toContain("setup.rerun");
    expect(result.actions).toContain("diagnostics.export");
    expect(existsSync(join(rootDir, "setup-state.json"))).toBe(true);
  });

  test("stores Telegram token in secrets file but redacts setup state", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      openClawBinaryPath: join(rootDir, "missing-openclaw"),
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: {},
      now: () => new Date("2026-05-24T12:00:00.000Z"),
      correlationIdFactory: () => "corr_telegram_configure",
    });

    const response = await service.configureTelegram("123456:telegram-secret");
    const state = await service.status();
    const rawState = readFileSync(join(rootDir, "setup-state.json"), "utf8");
    const secrets = readFileSync(join(rootDir, "secrets.env"), "utf8");

    expect(response).toMatchObject({
      ok: false,
      phase: "degraded",
      telegram: { tokenConfigured: true },
    });
    expect(state.telegram.tokenConfigured).toBe(true);
    expect(secrets).toContain("OPENCLAW_TELEGRAM_BOT_TOKEN=123456:telegram-secret");
    expect(rawState).not.toContain("telegram-secret");
  });

  test("tests Telegram from environment without exposing the token", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agenos-openclaw-setup-"));
    const service = createOpenClawSetupService({
      stateDir: rootDir,
      openClawBinaryPath: join(rootDir, "missing-openclaw"),
      bundledWorkerPath: join(rootDir, "missing-bundled-worker"),
      env: { OPENCLAW_TELEGRAM_BOT_TOKEN: "123456:telegram-secret" },
      now: () => new Date("2026-05-24T12:00:00.000Z"),
      correlationIdFactory: () => "corr_telegram_test",
      telegramProbe: async (token) => ({
        ok: token.startsWith("123456:"),
        botUsername: "agenos_test_bot",
        message: "Telegram bot reachable.",
      }),
    });

    const response = await service.testTelegram();
    const rawState = readFileSync(join(rootDir, "setup-state.json"), "utf8");

    expect(response).toMatchObject({
      ok: false,
      phase: "degraded",
      telegram: {
        tokenConfigured: true,
        botUsername: "agenos_test_bot",
        lastTestOk: true,
      },
    });
    expect(rawState).not.toContain("telegram-secret");
  });
});
