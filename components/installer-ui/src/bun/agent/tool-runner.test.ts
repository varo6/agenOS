import { describe, expect, test } from "bun:test";
import { createToolRunner } from "./tool-runner";

describe("agent tool runner", () => {
  test("denies ordinary shell from worker", async () => {
    const commands: string[] = [];
    const runner = createToolRunner({
      shellTool: async (input) => {
        commands.push(input.command);
        return {
          ok: true,
          command: input.command,
          cwd: "/tmp",
          exitCode: 0,
          signal: null,
          stdout: "active\n",
          stderr: "",
          timedOut: false,
          message: "Comando completado.",
        };
      },
    });

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_test",
      tool: "shell.exec",
      input: { command: "systemctl status ssh" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "deny",
    });
    expect(commands).toEqual([]);
  });

  test("denies destructive worker shell without creating confirmation requests", async () => {
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
      decision: "deny",
    });
    expect(created).toHaveLength(0);
  });

  test("turns background memory writes into confirmation requests", async () => {
    const created: unknown[] = [];
    const runner = createToolRunner({
      memoryStore: {
        append: () => ({ ok: true, message: "Memoria guardada." }),
      } as never,
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

  test("creates a friendly package confirmation only for validated resolved input", async () => {
    const created: unknown[] = [];
    const runner = createToolRunner({
      confirmations: {
        create: (request) => {
          created.push(request);
          return { confirmationId: "conf_firefox", status: "pending" };
        },
      } as never,
      handlers: {
        "packages.install": async () => ({ ok: true, status: "installed" }),
      },
    });
    const validInput = {
      packageName: "firefox-esr",
      displayName: "Firefox ESR",
      requestedName: "firefox",
      version: "128.0",
      selectionReason: "alias",
    };

    await expect(runner.run({
      source: "ui",
      tool: "packages.install",
      input: validInput,
    })).resolves.toMatchObject({
      ok: false,
      decision: "confirm",
      confirmationId: "conf_firefox",
    });
    expect(created).toEqual([expect.objectContaining({
      tool: "packages.install",
      summary: "Voy a instalar Firefox ESR (firefox-esr), ¿sigo?",
      input: validInput,
    })]);

    await expect(runner.run({
      source: "ui",
      tool: "packages.install",
      input: { ...validInput, packageName: "firefox-esr;id" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "deny",
      message: expect.stringContaining("resuelto y validado"),
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
      explicitUserIntent: true,
    })).resolves.toMatchObject({
      ok: true,
      decision: "allow",
      message: "Comando completado.",
      shell: { stdout: "uid=1000\n" },
    });
  });

  test("fails unsupported outbound tools without creating a useless confirmation", async () => {
    const created: unknown[] = [];
    const runner = createToolRunner({
      confirmations: {
        create: (request) => {
          created.push(request);
          return { confirmationId: "conf_outbound", status: "pending" };
        },
      } as never,
    });

    await expect(runner.run({
      source: "openclaw",
      taskId: "task_outbound",
      tool: "outbound.send",
      input: { channel: "email", body: "hola" },
    })).resolves.toMatchObject({
      ok: false,
      decision: "deny",
      message: expect.stringContaining("no esta disponible"),
    });
    expect(created).toHaveLength(0);
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
      message: expect.stringContaining("no esta disponible"),
    });
  });

  test("executes a confirmed UI shell effect but rejects legacy worker shell confirmations", async () => {
    const commands: string[] = [];
    const runner = createToolRunner({
      shellTool: async (input) => {
        commands.push(input.command);
        return {
          ok: true,
          command: input.command,
          cwd: "/tmp",
          exitCode: 0,
          signal: null,
          stdout: "done\n",
          stderr: "",
          timedOut: false,
          message: "Comando completado.",
        };
      },
    });
    const baseRecord = {
      schemaVersion: 1 as const,
      confirmationId: "conf_shell",
      correlationId: "corr_shell",
      timestamp: "2026-08-13T10:00:00.000Z",
      action: "confirmation.confirm" as const,
      status: "confirmed" as const,
      tool: "shell.exec",
      summary: "shell",
      input: { command: "rm -rf ~/Documentos" },
      actor: "ui" as const,
    };

    await expect(runner.executeConfirmed({ ...baseRecord, source: "ui" })).resolves.toMatchObject({
      ok: true,
      decision: "allow",
      shell: { command: "rm -rf ~/Documentos" },
    });
    await expect(runner.executeConfirmed({ ...baseRecord, source: "openclaw" })).resolves.toMatchObject({
      ok: false,
      decision: "deny",
      message: expect.stringContaining("no reciben shell"),
    });
    expect(commands).toEqual(["rm -rf ~/Documentos"]);
  });
});
