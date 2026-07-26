import { describe, expect, test } from "bun:test";
import { createOpenClawSetupModelTool } from "./openclaw-setup-tool";
import type { OpenClawCodexLoginState, OpenClawSetupState } from "./setup";

function fakeLogin(overrides: Partial<OpenClawCodexLoginState> = {}): OpenClawCodexLoginState {
  return {
    status: "idle",
    url: null,
    userCode: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

function fakeState(overrides: Partial<OpenClawSetupState> = {}, login: Partial<OpenClawCodexLoginState> = {}): OpenClawSetupState {
  return {
    schemaVersion: 1,
    ok: false,
    phase: "needs_auth",
    message: "Setup state",
    workerMode: "openclaw",
    openclaw: {
      installed: true,
      healthy: true,
      binaryPath: "/usr/bin/openclaw",
      version: "openclaw 2026.6.11",
      gatewayUrl: "http://127.0.0.1:18789",
      lastError: null,
    },
    codex: {
      configured: false,
      profile: null,
      loginAvailable: true,
      lastError: "Backend Codex auth is not configured.",
      login: fakeLogin(login),
    },
    telegram: {
      enabled: false,
      tokenConfigured: false,
      botUsername: null,
      lastTestOk: null,
      lastError: null,
    },
    actions: ["setup.rerun", "diagnostics.export", "codex.login"],
    updatedAt: "2026-07-03T12:00:00.000Z",
    correlationId: "corr_test",
    ...overrides,
  };
}

describe("openclaw_setup tool", () => {
  const mockSetupService = {
    status: async () => fakeState({ phase: "ready", ok: true, message: "All good" }),
    run: async () => fakeState({ message: "Run executed" }),
    startCodexLogin: async () =>
      fakeState({}, { status: "pending", url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", startedAt: "2026-07-03T12:00:00.000Z" }),
    codexLoginStatus: async () =>
      fakeState({}, { status: "pending", url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", startedAt: "2026-07-03T12:00:00.000Z" }),
    configureTelegram: async (token: string) => fakeState({ message: `Token ${token} configured` }),
    testTelegram: async () => fakeState({ message: "Test passed" }),
    enableTelegram: async () => fakeState({ message: "Enabled" }),
  };

  const tool = createOpenClawSetupModelTool(mockSetupService);

  test("status action", async () => {
    const result = await tool.execute("call_1", { action: "status" });
    expect(result.content[0]?.text).toContain("fase=ready");
    expect(result.details).toMatchObject({ phase: "ready" });
  });

  test("run action", async () => {
    const result = await tool.execute("call_2", { action: "run" });
    expect(result.content[0]?.text).toContain("Setup re-ejecutado");
    expect(result.content[0]?.text).toContain("fase=needs_auth");
  });

  test("codex_login action relays URL and user code", async () => {
    const result = await tool.execute("call_3", { action: "codex_login" });
    expect(result.content[0]?.text).toContain("https://auth.openai.com/codex/device");
    expect(result.content[0]?.text).toContain("ABCD-1234");
    expect(result.content[0]?.text).toContain("codex_login_status");
  });

  test("codex_login action reports already configured auth", async () => {
    const configuredTool = createOpenClawSetupModelTool({
      ...mockSetupService,
      startCodexLogin: async () => fakeState({ codex: { ...fakeState().codex, configured: true, login: fakeLogin() } }),
    });
    const result = await configuredTool.execute("call_3b", { action: "codex_login" });
    expect(result.content[0]?.text).toContain("ya esta completada");
  });

  test("codex_login_status action reports pending login", async () => {
    const result = await tool.execute("call_3c", { action: "codex_login_status" });
    expect(result.content[0]?.text).toContain("https://auth.openai.com/codex/device");
  });

  test("codex_login_status action reports failures", async () => {
    const failedTool = createOpenClawSetupModelTool({
      ...mockSetupService,
      codexLoginStatus: async () => fakeState({}, { status: "error", error: "codex exited with code 1" }),
    });
    const result = await failedTool.execute("call_3d", { action: "codex_login_status" });
    expect(result.content[0]?.text).toContain("codex exited with code 1");
  });

  test("telegram_configure action with token", async () => {
    const result = await tool.execute("call_4", { action: "telegram_configure", token: "my-token" });
    expect(result.content[0]?.text).toContain("Token my-token configured");
  });

  test("telegram_configure action without token fails", async () => {
    const result = await tool.execute("call_5", { action: "telegram_configure" });
    expect(result.content[0]?.text).toContain("Error:");
    expect((result.details as { error?: string }).error).toBe("Missing token");
  });

  test("telegram_test action", async () => {
    const result = await tool.execute("call_6", { action: "telegram_test" });
    expect(result.content[0]?.text).toContain("Test de Telegram");
  });

  test("telegram_enable action", async () => {
    const result = await tool.execute("call_7", { action: "telegram_enable" });
    expect(result.content[0]?.text).toContain("Activación de Telegram");
  });

  test("unknown action", async () => {
    const result = await tool.execute("call_8", { action: "unknown_action" });
    expect(result.content[0]?.text).toContain("Error: Acción desconocida");
  });
});
