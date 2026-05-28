import { describe, expect, test } from "bun:test";
import { createOpenClawSetupModelTool } from "./openclaw-setup-tool";

describe("openclaw_setup tool", () => {
  const mockSetupService = {
    status: async () => ({ phase: "ready", message: "All good" }),
    run: async () => ({ phase: "needs_auth", message: "Run executed" }),
    startCodexLogin: async () => ({ message: "Login started" }),
    configureTelegram: async (token: string) => ({ message: `Token ${token} configured` }),
    testTelegram: async () => ({ message: "Test passed" }),
    enableTelegram: async () => ({ message: "Enabled" }),
  } as any;

  const tool = createOpenClawSetupModelTool(mockSetupService);

  test("status action", async () => {
    const result = await tool.execute("call_1", { action: "status" });
    expect(result.content[0].text).toContain("fase=ready");
    expect(result.details).toMatchObject({ phase: "ready" });
  });

  test("run action", async () => {
    const result = await tool.execute("call_2", { action: "run" });
    expect(result.content[0].text).toContain("Detección re-ejecutada");
  });

  test("codex_login action", async () => {
    const result = await tool.execute("call_3", { action: "codex_login" });
    expect(result.content[0].text).toContain("Login de Codex iniciado");
  });

  test("telegram_configure action with token", async () => {
    const result = await tool.execute("call_4", { action: "telegram_configure", token: "my-token" });
    expect(result.content[0].text).toContain("Token my-token configured");
  });

  test("telegram_configure action without token fails", async () => {
    const result = await tool.execute("call_5", { action: "telegram_configure" });
    expect(result.content[0].text).toContain("Error:");
    expect((result.details as any).error).toBe("Missing token");
  });

  test("telegram_test action", async () => {
    const result = await tool.execute("call_6", { action: "telegram_test" });
    expect(result.content[0].text).toContain("Test de Telegram");
  });

  test("telegram_enable action", async () => {
    const result = await tool.execute("call_7", { action: "telegram_enable" });
    expect(result.content[0].text).toContain("Activación de Telegram");
  });

  test("unknown action", async () => {
    const result = await tool.execute("call_8", { action: "unknown_action" });
    expect(result.content[0].text).toContain("Error: Acción desconocida");
  });
});
