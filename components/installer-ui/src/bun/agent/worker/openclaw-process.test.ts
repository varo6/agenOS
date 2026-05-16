import { describe, expect, test } from "bun:test";
import { createOpenClawProcessAdapter } from "./openclaw-process";

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
});
