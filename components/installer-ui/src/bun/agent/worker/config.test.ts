import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkerConfig, redactWorkerConfig } from "./config";

describe("worker config", () => {
  test("merges system defaults with user config", () => {
    const root = mkdtempSync(join(tmpdir(), "agenos-openclaw-config-"));
    const systemConfigPath = join(root, "system.json");
    const userConfigPath = join(root, "user.json");

    writeFileSync(
      systemConfigPath,
      JSON.stringify({
        schemaVersion: 1,
        mode: "auto",
        stateDir: "/home/agenos/.agenos/openclaw",
        channels: { email: false, telegram: false, whatsapp: false },
        policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
      }),
    );
    writeFileSync(
      userConfigPath,
      JSON.stringify({
        schemaVersion: 1,
        mode: "local-simulated",
        provider: "openai",
        model: "gpt-5.4-mini",
        apiAuth: { type: "env", envVar: "OPENCLAW_API_KEY" },
        channels: { email: true },
      }),
    );

    expect(readWorkerConfig({ systemConfigPath, userConfigPath })).toMatchObject({
      schemaVersion: 1,
      mode: "local-simulated",
      provider: "openai",
      model: "gpt-5.4-mini",
      stateDir: "/home/agenos/.agenos/openclaw",
      apiAuth: { type: "env", envVar: "OPENCLAW_API_KEY" },
      channels: { email: true, telegram: false, whatsapp: false },
      policyDefaults: { memoryWrite: "confirm", outboundSend: "confirm" },
    });
  });

  test("redacts auth material for API responses", () => {
    const config = readWorkerConfig({
      systemConfigPath: "/missing-system.json",
      userConfigPath: "/missing-user.json",
      env: { AGENOS_OPENCLAW_API_KEY: "secret" },
    });

    expect(redactWorkerConfig(config).apiAuth).toEqual({
      type: "env",
      envVar: "AGENOS_OPENCLAW_API_KEY",
      configured: true,
    });
  });
});
