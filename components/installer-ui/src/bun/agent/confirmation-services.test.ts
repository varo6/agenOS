import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfirmationStore } from "./confirmations";
import { createToolRunner } from "./tool-runner";
import { createComputerRunService } from "./computer-run-service";
import { createGoogleSendService, describeGoogleSend } from "./google-send-service";

function harness(handlers: Record<string, (input: unknown) => unknown> = {}) {
  const confirmations = createConfirmationStore({ rootDir: mkdtempSync(join(tmpdir(), "agenos-conf-")) });
  const executed: Array<{ command: string }> = [];
  const toolRunner = createToolRunner({
    confirmations,
    shellTool: async (input) => {
      executed.push({ command: input.command });
      return {
        ok: true,
        command: input.command,
        cwd: "/home/agenos",
        exitCode: 0,
        signal: null,
        stdout: "hecho",
        stderr: "",
        timedOut: false,
        message: "Comando completado.",
      };
    },
    handlers,
  });
  return { confirmations, toolRunner, executed };
}

describe("computer run service", () => {
  test("ejecuta directamente un comando inocuo", async () => {
    const { confirmations, toolRunner, executed } = harness();
    const service = createComputerRunService({ toolRunner, confirmations });

    const outcome = await service.request({ command: "ls ~/Documentos" });

    expect(outcome.status).toBe("completed");
    expect(outcome.ok).toBe(true);
    expect(outcome.stdout).toBe("hecho");
    expect(executed).toEqual([{ command: "ls ~/Documentos" }]);
  });

  test("no ejecuta un comando destructivo hasta que el usuario confirma", async () => {
    const { confirmations, toolRunner, executed } = harness();
    const service = createComputerRunService({ toolRunner, confirmations });

    const pending = await service.request({ command: "rm -rf ~/Fotos" });

    expect(pending.status).toBe("confirmation_required");
    expect(pending.confirmationId).toBeTruthy();
    expect(pending.message).toContain("rm -rf ~/Fotos");
    expect(executed).toEqual([]);

    const done = await service.confirm(pending.confirmationId ?? "");

    expect(done.status).toBe("completed");
    expect(executed).toEqual([{ command: "rm -rf ~/Fotos" }]);
  });

  test("cancelar deja el sistema intacto y no permite reejecutar despues", async () => {
    const { confirmations, toolRunner, executed } = harness();
    const service = createComputerRunService({ toolRunner, confirmations });
    const pending = await service.request({ command: "mkfs.ext4 /dev/sda1" });

    const cancelled = service.deny(pending.confirmationId ?? "");
    expect(cancelled.status).toBe("cancelled");

    const retried = await service.confirm(pending.confirmationId ?? "");
    expect(retried.status).toBe("failed");
    expect(retried.message).toContain("cancelado");
    expect(executed).toEqual([]);
  });

  test("una confirmacion inexistente no ejecuta nada", async () => {
    const { confirmations, toolRunner, executed } = harness();
    const service = createComputerRunService({ toolRunner, confirmations });

    const outcome = await service.confirm("conf_inventado");

    expect(outcome.ok).toBe(false);
    expect(executed).toEqual([]);
  });

  test("rechaza el comando vacio sin llamar al broker", async () => {
    const { confirmations, toolRunner, executed } = harness();
    const service = createComputerRunService({ toolRunner, confirmations });

    const outcome = await service.request({ command: "   " });

    expect(outcome.ok).toBe(false);
    expect(executed).toEqual([]);
  });
});

describe("google send service", () => {
  function googleHarness() {
    const sent: unknown[] = [];
    const { confirmations, toolRunner } = harness({
      "google.send": (input) => {
        sent.push(input);
        return { ok: true, message: "Correo enviado." };
      },
    });
    return { sent, service: createGoogleSendService({ toolRunner, confirmations }) };
  }

  test("no envia nada hasta que el usuario confirma", async () => {
    const { sent, service } = googleHarness();

    const pending = await service.request("sendMessage", { to: "marta@example.com", subject: "Cita" });

    expect(pending.status).toBe("confirmation_required");
    expect(pending.message).toContain("marta@example.com");
    expect(pending.message).toContain("Cita");
    expect(sent).toEqual([]);

    const done = await service.confirm(pending.confirmationId ?? "");

    expect(done.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  test("cancelar un envio no manda el correo", async () => {
    const { sent, service } = googleHarness();
    const pending = await service.request("sendMessage", { to: "marta@example.com" });

    const cancelled = service.deny(pending.confirmationId ?? "");

    expect(cancelled.status).toBe("cancelled");
    expect(sent).toEqual([]);
  });

  test("un mismo envio no se puede confirmar dos veces", async () => {
    const { sent, service } = googleHarness();
    const pending = await service.request("createEvent", { summary: "Dentista", start: "2026-08-25T10:00:00" });

    await service.confirm(pending.confirmationId ?? "");
    const repeated = await service.confirm(pending.confirmationId ?? "");

    expect(repeated.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  test("la pregunta describe lo que se va a hacer", () => {
    expect(describeGoogleSend("sendMessage", { input: { to: "ana@example.com", subject: "Hola" } }))
      .toContain("ana@example.com");
    expect(describeGoogleSend("createEvent", { input: { summary: "Dentista", start: "el martes" } }))
      .toContain("Dentista");
    expect(describeGoogleSend("deleteEvent", { input: {} })).toContain("borrar");
  });
});
