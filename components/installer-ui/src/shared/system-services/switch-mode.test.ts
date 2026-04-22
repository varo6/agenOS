import { describe, expect, mock, test } from "bun:test";

import { createSwitchModeService } from "./switch-mode";

describe("createSwitchModeService", () => {
  test("returns success when the helper detaches after writing the mode override", async () => {
    const appendLog = mock(() => "/tmp/helper.log");
    const writeShellMode = mock(() => "/tmp/shell-mode");
    const removeFile = mock(() => {});
    const service = createSwitchModeService({
      uid: () => 1000,
      appendLog,
      writeShellMode,
      removeFile,
      spawnHelper: () => ({
        waitForExit: async () => null,
      }),
    });

    await expect(service.switchMode("installer")).resolves.toEqual({
      ok: true,
      message: "Cambiando a installer.",
    });
    expect(writeShellMode).toHaveBeenCalledWith("installer", 1000);
    expect(removeFile).not.toHaveBeenCalled();
  });

  test("removes the override file when the helper exits with error", async () => {
    const removeFile = mock(() => {});
    const service = createSwitchModeService({
      uid: () => 1000,
      writeShellMode: () => "/tmp/shell-mode",
      removeFile,
      appendLog: () => "/tmp/helper.log",
      spawnHelper: () => ({
        waitForExit: async () => 1,
      }),
    });

    await expect(service.switchMode("system")).resolves.toEqual({
      ok: false,
      message: "No se pudo recargar la shell para cambiar a system.",
    });
    expect(removeFile).toHaveBeenCalledWith("/tmp/shell-mode");
  });
});
