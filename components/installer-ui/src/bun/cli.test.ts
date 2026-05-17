import { describe, expect, test } from "bun:test";
import { runCli } from "./cli";

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
});
