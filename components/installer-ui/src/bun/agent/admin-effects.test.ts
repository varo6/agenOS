import { describe, expect, test } from "bun:test";
import { restartAgentWorker } from "./admin-effects";

describe("agent admin effects", () => {
  test("restarts only the allowlisted agent service through the privileged helper", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await restartAgentWorker({
      exec: async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stderr: "" };
      },
    });

    expect(result).toEqual({ ok: true, message: "Worker de AgenOS reiniciado." });
    expect(calls).toEqual([{
      command: "pkexec",
      args: ["/usr/local/bin/agenos-shell-helper", "restart-agent"],
    }]);
  });

  test("reports helper failures instead of claiming a restart", async () => {
    await expect(restartAgentWorker({
      exec: async () => ({ exitCode: 1, stderr: "not authorized" }),
    })).resolves.toEqual({
      ok: false,
      message: "No se pudo reiniciar el worker de AgenOS: not authorized",
    });
  });
});
