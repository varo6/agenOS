import { describe, expect, test } from "bun:test";
import { createSupportBundle } from "./support-bundle";

describe("support bundle", () => {
  test("collects redacted service commands, runtime paths and backend state", async () => {
    const commands: string[] = [];
    const bundle = await createSupportBundle({
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      env: {
        HOME: "/home/agenos",
        PI_PACKAGE_DIR: "/opt/agenos/installer/pi-coding-agent",
        AGENOS_OPENCLAW_SYSTEM_CONFIG: "/etc/agenos/openclaw.json",
        AGENOS_OPENCLAW_USER_CONFIG: "/home/agenos/.agenos/openclaw/config.json",
        AGENOS_OPENCLAW_STATE_DIR: "/home/agenos/.agenos/openclaw",
        AGENOS_WORKER_TOKEN_PATH: "/home/agenos/.agenos/broker/worker-token",
      },
      fetch: async (input) => new Response(JSON.stringify({ ok: true, input: String(input) }), { status: 200 }),
      agentAdmin: {
        status: async () => ({
          ok: true,
          readiness: "ready",
          setupItems: [],
          worker: { mode: "agenos-bun-worker", serviceActive: true },
          config: { apiAuth: { type: "env", envVar: "OPENAI_API_KEY", configured: true } },
        }),
        readConfig: async () => ({
          apiAuth: { type: "env", envVar: "OPENAI_API_KEY", configured: true },
        }),
      },
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "));
        return {
          exitCode: 0,
          stdout: "active OPENAI_API_KEY=sk-live-secret",
          stderr: "",
        };
      },
    });

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-05-16T12:00:00.000Z",
      runtime: {
        paths: {
          runtimeDir: "/home/agenos/.cache/agenos-installer/runtime",
          apiLog: "/home/agenos/.cache/agenos-installer/runtime/api.log",
          piPackageDir: "/opt/agenos/installer/pi-coding-agent",
        },
      },
      agent: {
        status: { worker: { mode: "agenos-bun-worker", serviceActive: true } },
        config: { apiAuth: { configured: true } },
      },
    });
    expect(commands).toContain("systemctl status agenos-agent-api.service --no-pager --full");
    expect(commands).toContain("journalctl -u agenos-openclaw.service -n 120 --no-pager");
    expect(JSON.stringify(bundle)).not.toContain("sk-live-secret");
    expect(JSON.stringify(bundle)).toContain("[redacted]");
  });
});
