import { describe, expect, test } from "bun:test";
import { runCli, workerHealthPollDelayMs } from "./cli";

describe("worker health polling", () => {
  test("polls healthy workers rarely and backs off persistent failures", () => {
    expect(workerHealthPollDelayMs(true, 0)).toBe(300_000);
    expect(workerHealthPollDelayMs(false, 0)).toBe(30_000);
    expect(workerHealthPollDelayMs(false, 1)).toBe(60_000);
    expect(workerHealthPollDelayMs(false, 4)).toBe(300_000);
    expect(workerHealthPollDelayMs(false, 20)).toBe(300_000);
  });
});

describe("runCli", () => {
  test("doctor prints a redacted support bundle as JSON", async () => {
    const lines: string[] = [];
    const result = await runCli(["doctor"], {
      createSupportBundle: async () => ({
        schemaVersion: 1,
        generatedAt: "2026-05-16T12:00:00.000Z",
        commands: [
          { command: "journalctl", args: ["-u", "agenos-agent-api.service"], ok: true, stdout: "[redacted]" },
        ],
      }),
      console: {
        log: (line) => lines.push(String(line)),
        error: () => undefined,
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(JSON.parse(lines.join("\n"))).toMatchObject({
      schemaVersion: 1,
      commands: [{ command: "journalctl", stdout: "[redacted]" }],
    });
  });

  test("setup-openclaw prints setup state as JSON", async () => {
    const lines: string[] = [];
    const result = await runCli(["setup-openclaw"], {
      setupOpenClaw: async () => ({
        ok: false,
        phase: "degraded",
        message: "OpenClaw binary not found.",
        actions: ["setup.rerun", "diagnostics.export"],
      }),
      console: {
        log: (line) => lines.push(String(line)),
        error: () => undefined,
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(JSON.parse(lines.join("\n"))).toMatchObject({
      ok: false,
      phase: "degraded",
      actions: ["setup.rerun", "diagnostics.export"],
    });
  });
});
