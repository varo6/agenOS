import { describe, expect, test } from "bun:test";

import {
  INVALID_MAINTENANCE_ACTION_MESSAGE,
  isMaintenanceAction,
  isPowerMaintenanceAction,
  MAINTENANCE_ACTIONS,
  resolveElectronGpuState,
  shouldTrackGpuFallback,
} from "./runtime";

describe("isMaintenanceAction", () => {
  test("accepts exactly the actions the privileged helper implements", () => {
    expect([...MAINTENANCE_ACTIONS]).toEqual(["terminal", "poweroff", "reboot"]);

    for (const action of MAINTENANCE_ACTIONS) {
      expect(isMaintenanceAction(action)).toBe(true);
    }
  });

  // La frontera existe para que nada que no sea uno de esos nombres llegue a
  // `pkexec`: ni un comando, ni una variante, ni un objeto con la forma justa.
  test("rejects anything else, including near misses and injected commands", () => {
    for (const value of [
      "reload-shell",
      "restart-agent",
      "suspend",
      "poweroff; id",
      "poweroff reboot",
      " poweroff",
      "PowerOff",
      "",
      null,
      undefined,
      1,
      ["poweroff"],
      { action: "poweroff" },
      new String("poweroff"),
    ]) {
      expect(isMaintenanceAction(value)).toBe(false);
    }
  });

  test("names the accepted actions when it rejects one", () => {
    expect(INVALID_MAINTENANCE_ACTION_MESSAGE).toBe("La acción debe ser una de: terminal, poweroff, reboot.");
  });
});

describe("isPowerMaintenanceAction", () => {
  // Apagar y reiniciar no vuelven: el servicio los espera de otra forma.
  test("separates the actions that take the machine down", () => {
    expect(isPowerMaintenanceAction("poweroff")).toBe(true);
    expect(isPowerMaintenanceAction("reboot")).toBe(true);
    expect(isPowerMaintenanceAction("terminal")).toBe(false);
    expect(isPowerMaintenanceAction("suspend")).toBe(false);
  });
});

describe("resolveElectronGpuState", () => {
  test("keeps installer mode in GPU off", () => {
    expect(resolveElectronGpuState({
      appKind: "installer",
      requestedMode: "on",
      persistedState: "on",
    })).toBe("off");
  });

  test("uses persisted off state when system mode runs in auto", () => {
    expect(resolveElectronGpuState({
      appKind: "system",
      requestedMode: "auto",
      persistedState: "off",
    })).toBe("off");
  });

  test("defaults system mode auto to GPU on on a clean start", () => {
    expect(resolveElectronGpuState({
      appKind: "system",
      requestedMode: "auto",
      persistedState: null,
    })).toBe("on");
  });
});

describe("shouldTrackGpuFallback", () => {
  test("tracks only the system shell in auto mode when GPU starts enabled", () => {
    expect(shouldTrackGpuFallback({
      appKind: "system",
      requestedMode: "auto",
      effectiveState: "on",
    })).toBe(true);
  });

  test("does not track installer mode", () => {
    expect(shouldTrackGpuFallback({
      appKind: "installer",
      requestedMode: "auto",
      effectiveState: "on",
    })).toBe(false);
  });
});
