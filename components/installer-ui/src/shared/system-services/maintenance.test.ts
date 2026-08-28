import { describe, expect, test } from "bun:test";

import { createMaintenanceService } from "./maintenance";

type SpawnCall = { action: string; uid: number; waitMs: number };

function serviceWith(exitCode: number | null) {
  const calls: SpawnCall[] = [];
  const service = createMaintenanceService({
    uid: () => 1000,
    helperLogPath: () => "/run/user/1000/agenos-installer/helper.log",
    spawnHelper: (action, uid) => ({
      waitForExit: async (timeoutMs: number) => {
        calls.push({ action, uid, waitMs: timeoutMs });
        return exitCode;
      },
    }),
  });

  return { calls, service };
}

describe("createMaintenanceService", () => {
  test("hands the typed action to the privileged helper", async () => {
    const { calls, service } = serviceWith(0);

    await expect(service.runMaintenance("poweroff")).resolves.toEqual({
      ok: true,
      message: "El sistema ha aceptado la orden de apagado.",
    });
    await expect(service.runMaintenance("reboot")).resolves.toEqual({
      ok: true,
      message: "El sistema ha aceptado la orden de reinicio.",
    });

    expect(calls.map((call) => call.action)).toEqual(["poweroff", "reboot"]);
    expect(calls.every((call) => call.uid === 1000)).toBe(true);
  });

  /*
   * Abrir un terminal se lanza y se olvida; apagar no. Si alguien cancela el
   * diálogo de polkit, el helper sale con 126 y eso puede tardar más de un
   * segundo: con la ventana corta, la respuesta decía "hecho" mientras la
   * máquina seguía encendida.
   */
  test("waits long enough for the polkit prompt on the actions that take the machine down", async () => {
    const { calls, service } = serviceWith(0);

    await service.runMaintenance("terminal");
    await service.runMaintenance("poweroff");
    await service.runMaintenance("reboot");

    const [terminal, poweroff, reboot] = calls;
    expect(terminal?.waitMs).toBe(1_000);
    expect(poweroff?.waitMs).toBe(30_000);
    expect(reboot?.waitMs).toBe(30_000);
  });

  test("reports a cancelled authorization as a failure, not as an accepted order", async () => {
    const { service } = serviceWith(126);

    await expect(service.runMaintenance("poweroff")).resolves.toMatchObject({
      ok: false,
    });
    const response = await service.runMaintenance("poweroff");
    expect(response.message).toContain("126");
    expect(response.message).toContain("/run/user/1000/agenos-installer/helper.log");
  });

  // Un helper que sigue vivo al agotarse la espera es el caso normal de
  // `terminal`: se ha lanzado y no ha fallado.
  test("treats a still-running helper as launched", async () => {
    const { service } = serviceWith(null);

    await expect(service.runMaintenance("terminal")).resolves.toEqual({
      ok: true,
      message: "Acción terminal lanzada.",
    });
  });

  test("surfaces a spawn failure instead of throwing at the IPC boundary", async () => {
    const service = createMaintenanceService({
      uid: () => 1000,
      helperLogPath: () => "/run/user/1000/agenos-installer/helper.log",
      spawnHelper: () => {
        throw new Error("pkexec no está instalado");
      },
    });

    await expect(service.runMaintenance("reboot")).resolves.toEqual({
      ok: false,
      message: "pkexec no está instalado",
    });
  });
});
