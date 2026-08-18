import { describe, expect, test } from "bun:test";
import { createComputerRunModelTool, type ComputerRunner, type ComputerRunOutcome, type ComputerRunService } from "./computer-run-tool";
import type { ShellExecResult } from "./shell";

function shellResult(overrides: Partial<ShellExecResult> = {}): ShellExecResult {
  return {
    ok: true,
    command: "echo hola",
    cwd: "/home/tester",
    exitCode: 0,
    signal: null,
    stdout: "hola\n",
    stderr: "",
    timedOut: false,
    message: "Comando completado.",
    ...overrides,
  };
}

// El tool habla con el servicio del broker; estos tests siguen describiendo el
// comportamiento del comando envolviendo un runner simple en ese contrato.
function serviceFrom(runner: ComputerRunner): ComputerRunService {
  return {
    async request(input) {
      const shell = await runner(input);
      return {
        status: "completed",
        ok: shell.ok,
        exitCode: shell.exitCode,
        stdout: shell.stdout,
        stderr: shell.stderr,
        timedOut: shell.timedOut,
        command: shell.command || input.command,
        message: shell.message,
      };
    },
    async confirm() {
      throw new Error("no usado");
    },
    deny() {
      throw new Error("no usado");
    },
  };
}

function outcome(overrides: Partial<ComputerRunOutcome> = {}): ComputerRunOutcome {
  return {
    status: "completed",
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    command: "echo hola",
    message: "Comando completado.",
    ...overrides,
  };
}

describe("computer_run model tool", () => {
  test("expone el contrato del tool", () => {
    const tool = createComputerRunModelTool(serviceFrom(async () => shellResult()));
    expect(tool.name).toBe("computer_run");
    expect(tool.label).toBe("Ejecutar en el ordenador");
    expect(tool.parameters).toMatchObject({
      type: "object",
      required: [],
      additionalProperties: false,
    });
  });

  test("ejecuta el comando y devuelve el stdout al modelo", async () => {
    const calls: Array<{ command: string; cwd?: string; timeoutMs?: number }> = [];
    const runner: ComputerRunner = async (input) => {
      calls.push(input);
      return shellResult({ command: "ls ~/Documentos", stdout: "notas.md\nfoto.png\n" });
    };

    const result = await createComputerRunModelTool(serviceFrom(runner)).execute("call_1", {
      command: "  ls ~/Documentos  ",
      cwd: "/home/tester",
      timeoutMs: 5000,
    });

    expect(calls).toEqual([{ command: "ls ~/Documentos", cwd: "/home/tester", timeoutMs: 5000 }]);
    expect(result.content[0]?.text).toContain("notas.md");
    expect(result.content[0]?.text).toContain("foto.png");
    expect(result.details).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: "notas.md\nfoto.png\n",
      timedOut: false,
      command: "ls ~/Documentos",
    });
  });

  test("omite cwd y timeoutMs cuando no vienen en los parametros", async () => {
    const calls: Array<{ command: string; cwd?: string; timeoutMs?: number }> = [];
    const tool = createComputerRunModelTool(serviceFrom(async (input) => {
      calls.push(input);
      return shellResult();
    }));

    await tool.execute("call_1", { command: "echo hola", cwd: "   ", timeoutMs: "rapido" });

    expect(calls).toEqual([{ command: "echo hola", cwd: undefined, timeoutMs: undefined }]);
  });

  test("informa del codigo de salida y del stderr cuando el comando falla", async () => {
    const tool = createComputerRunModelTool(serviceFrom(async () => shellResult({
      ok: false,
      command: "cat /root/secreto",
      exitCode: 1,
      stdout: "",
      stderr: "cat: /root/secreto: Permission denied",
      message: "Comando terminado con codigo 1.",
    })));

    const result = await tool.execute("call_1", { command: "cat /root/secreto" });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("código de salida 1");
    expect(text).toContain("Permission denied");
    expect(result.details).toMatchObject({ ok: false, exitCode: 1, stderr: "cat: /root/secreto: Permission denied" });
  });

  test("explica el timeout sin perder el mensaje del shell", async () => {
    const tool = createComputerRunModelTool(serviceFrom(async () => shellResult({
      ok: false,
      command: "sleep 999",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      message: "Comando cancelado por timeout tras 30000ms.",
    })));

    const result = await tool.execute("call_1", { command: "sleep 999" });

    expect(result.content[0]?.text).toContain("timeout");
    expect(result.details).toMatchObject({ ok: false, timedOut: true, exitCode: null });
  });

  test("trunca salidas enormes con el aviso de truncado", async () => {
    const tool = createComputerRunModelTool(serviceFrom(async () => shellResult({ stdout: "x".repeat(20_000) })));

    const result = await tool.execute("call_1", { command: "cat enorme.log" });

    const text = result.content[0]?.text ?? "";
    expect(text.endsWith("\n[salida truncada]")).toBe(true);
    expect(text.length).toBeLessThan(4200);
  });

  test("nunca propaga la excepcion del runner", async () => {
    const tool = createComputerRunModelTool(serviceFrom(async () => {
      throw new Error("El broker no está disponible.");
    }));

    const result = await tool.execute("call_1", { command: "uname -a" });

    expect(result.content[0]?.text).toContain("El broker no está disponible.");
    expect(result.details).toMatchObject({
      ok: false,
      exitCode: null,
      timedOut: false,
      command: "uname -a",
    });
  });

  test("rechaza un comando vacio sin llamar al runner", async () => {
    let calls = 0;
    const tool = createComputerRunModelTool(serviceFrom(async () => {
      calls += 1;
      return shellResult();
    }));

    const result = await tool.execute("call_1", { command: "   " });

    expect(calls).toBe(0);
    expect(result.details).toMatchObject({ ok: false, command: "" });
    expect(result.content[0]?.text).toContain("obligatorio");
  });

  test("traslada la pregunta del broker cuando el comando necesita confirmacion", async () => {
    const tool = createComputerRunModelTool({
      request: async () => outcome({
        status: "confirmation_required",
        ok: false,
        confirmationId: "conf_1",
        command: "rm -rf ~/Fotos",
        message: "Voy a ejecutar «rm -rf ~/Fotos». ¿Sigo?",
      }),
      confirm: async () => outcome(),
      deny: () => outcome(),
    });

    const result = await tool.execute("call_1", { command: "rm -rf ~/Fotos" });

    expect(result.content[0]?.text).toContain("¿Sigo?");
    expect(result.details).toMatchObject({ status: "confirmation_required", confirmationId: "conf_1" });
  });

  test("ejecuta el comando pendiente solo cuando llega la confirmacion", async () => {
    const confirmed: string[] = [];
    const tool = createComputerRunModelTool({
      request: async () => outcome({ status: "confirmation_required", ok: false, confirmationId: "conf_1" }),
      confirm: async (id) => {
        confirmed.push(id);
        return outcome({ command: "rm -rf ~/Fotos", stdout: "", message: "Comando completado." });
      },
      deny: () => outcome({ status: "cancelled", message: "Comando cancelado; no se ejecutó nada." }),
    });

    const result = await tool.execute("call_2", { action: "confirm", confirmationId: "conf_1" });

    expect(confirmed).toEqual(["conf_1"]);
    expect(result.details).toMatchObject({ status: "completed", ok: true });
  });

  test("cancela sin ejecutar cuando el usuario dice que no", async () => {
    const tool = createComputerRunModelTool({
      request: async () => outcome(),
      confirm: async () => outcome(),
      deny: () => outcome({ status: "cancelled", ok: true, message: "Comando cancelado; no se ejecutó nada." }),
    });

    const result = await tool.execute("call_3", { action: "deny", confirmationId: "conf_1" });

    expect(result.content[0]?.text).toContain("cancelado");
    expect(result.details).toMatchObject({ status: "cancelled" });
  });

  test("pide el confirmationId cuando falta", async () => {
    const tool = createComputerRunModelTool({
      request: async () => outcome(),
      confirm: async () => outcome(),
      deny: () => outcome(),
    });

    const result = await tool.execute("call_4", { action: "confirm" });

    expect(result.details).toMatchObject({ ok: false });
    expect(result.content[0]?.text).toContain("confirmationId");
  });
});
