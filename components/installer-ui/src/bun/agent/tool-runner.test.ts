import { describe, expect, test } from "bun:test";
import { createToolRunner } from "./tool-runner";

describe("agent tool runner", () => {
  test("executes ordinary shell from worker", async () => {
    const runner = createToolRunner({
      shellTool: async (input) => ({
        ok: true,
        command: input.command,
        cwd: "/tmp",
        exitCode: 0,
        signal: null,
        stdout: "active\n",
        stderr: "",
        timedOut: false,
        message: "Comando completado.",
      }),
    });

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_test",
      tool: "shell.exec",
      input: { command: "systemctl status ssh" },
    })).resolves.toMatchObject({
      ok: true,
      decision: "allow",
      shell: { stdout: "active\n" },
    });
  });

  test("turns destructive worker shell into confirmation requests", async () => {
    const created: unknown[] = [];
    const runner = createToolRunner({
      confirmations: {
        create: (request) => {
          created.push(request);
          return { confirmationId: "conf_shell", status: "pending" };
        },
      } as never,
    });

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_test",
      tool: "shell.exec",
      input: { command: "rm -rf ~/Documentos" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "confirm",
      confirmationId: "conf_shell",
    });
    expect(created).toHaveLength(1);
  });

  test("turns background memory writes into confirmation requests", async () => {
    const created: unknown[] = [];
    const runner = createToolRunner({
      confirmations: {
        create: (request) => {
          created.push(request);
          return { confirmationId: "conf_test", status: "pending" };
        },
      } as never,
    });

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_test",
      tool: "memory.write",
      input: { namespace: "facts", content: "Pablo Lopez es mi profesor" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "confirm",
      confirmationId: "conf_test",
    });
    expect(created).toHaveLength(1);
  });

  test("executes shell from the frontend superuser", async () => {
    const runner = createToolRunner({
      shellTool: async (input) => ({
        ok: true,
        command: input.command,
        cwd: "/tmp",
        exitCode: 0,
        signal: null,
        stdout: "uid=1000\n",
        stderr: "",
        timedOut: false,
        message: "Comando completado.",
      }),
    });

    await expect(runner.run({
      source: "ui",
      tool: "shell.exec",
      input: { command: "id" },
    })).resolves.toMatchObject({
      ok: true,
      decision: "allow",
      message: "Comando completado.",
      shell: { stdout: "uid=1000\n" },
    });
  });
});
