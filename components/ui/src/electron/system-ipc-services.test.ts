import { describe, expect, test } from "bun:test";
import { createSystemIpcServices } from "./system-ipc-services";

describe("system IPC services", () => {
  test("returns real preflight data from the shared service", () => {
    const services = createSystemIpcServices({
      preflight: {
        getPreflight: () => ({
          firmware: "UEFI",
          isLiveSession: true,
          totalRamBytes: 8 * 1024 ** 3,
          installableDiskBytes: 64 * 1024 ** 3,
          checks: [{ id: "ram", label: "RAM", status: "ok", detail: "8 GB" }],
        }),
      },
    });

    expect(services.getPreflight()).toMatchObject({
      totalRamBytes: 8 * 1024 ** 3,
      installableDiskBytes: 64 * 1024 ** 3,
      checks: [{ id: "ram", status: "ok" }],
    });
  });

  test("delegates maintenance and mode changes to effectful shared services", async () => {
    const effects: string[] = [];
    const services = createSystemIpcServices({
      maintenance: {
        runMaintenance: async (action) => {
          effects.push(`maintenance:${action}`);
          return { ok: true, message: "terminal abierto" };
        },
      },
      modeSwitch: {
        switchMode: async (mode) => {
          effects.push(`mode:${mode}`);
          return { ok: true, message: "modo persistido y shell recargada" };
        },
      },
    });

    await expect(services.runMaintenance("terminal")).resolves.toEqual({ ok: true, message: "terminal abierto" });
    await expect(services.switchMode("installer")).resolves.toEqual({ ok: true, message: "modo persistido y shell recargada" });
    expect(effects).toEqual(["maintenance:terminal", "mode:installer"]);
  });

  test("passes the typed power actions through to the privileged helper", async () => {
    const effects: string[] = [];
    const services = createSystemIpcServices({
      maintenance: {
        runMaintenance: async (action) => {
          effects.push(`maintenance:${action}`);
          return { ok: true, message: `Acción ${action} aceptada.` };
        },
      },
    });

    await expect(services.runMaintenance("poweroff")).resolves.toEqual({
      ok: true,
      message: "Acción poweroff aceptada.",
    });
    await expect(services.runMaintenance("reboot")).resolves.toEqual({
      ok: true,
      message: "Acción reboot aceptada.",
    });
    expect(effects).toEqual(["maintenance:poweroff", "maintenance:reboot"]);
  });

  test("rejects invalid IPC payloads without invoking an effect", async () => {
    const effects: string[] = [];
    const services = createSystemIpcServices({
      maintenance: { runMaintenance: async () => { effects.push("maintenance"); return { ok: true }; } },
      modeSwitch: { switchMode: async () => { effects.push("mode"); return { ok: true }; } },
    });

    // Ni acciones que el helper no conoce, ni comandos, ni nada que no sea una
    // de las cadenas de la lista cerrada.
    for (const action of ["reload-shell", "suspend", "poweroff; id", "PowerOff", "", 1, null, { action: "poweroff" }]) {
      await expect(services.runMaintenance(action)).resolves.toMatchObject({ ok: false });
    }
    await expect(services.switchMode("demo")).resolves.toMatchObject({ ok: false });
    expect(effects).toEqual([]);
  });
});
