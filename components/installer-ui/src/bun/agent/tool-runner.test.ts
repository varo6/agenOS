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

  test("executes ordinary shell from the authenticated frontend path", async () => {
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

  test("executes allowlisted effects only through registered broker handlers", async () => {
    const calls: unknown[] = [];
    const runner = createToolRunner({
      handlers: {
        "apps.open": async (input, context) => {
          calls.push({ input, context });
          return { ok: true, message: "App abierta." };
        },
      },
      correlationIdFactory: () => "corr_handler",
    });

    await expect(runner.run({
      source: "ui",
      tool: "apps.open",
      input: { app: "Fotos" },
    })).resolves.toMatchObject({
      ok: true,
      decision: "allow",
      output: { ok: true, message: "App abierta." },
    });
    expect(calls).toEqual([{
      input: { app: "Fotos" },
      context: { source: "ui", correlationId: "corr_handler" },
    }]);
  });

  test("fails closed when policy allows a tool without an executor", async () => {
    await expect(createToolRunner().run({
      source: "ui",
      tool: "apps.open",
      input: { app: "Fotos" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "deny",
      message: "No hay un ejecutor registrado para apps.open.",
    });
  });
});
