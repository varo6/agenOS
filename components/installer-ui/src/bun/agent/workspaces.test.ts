import { describe, expect, test } from "bun:test";
import { createWorkspaceService, normalizeWorkspaceNumber, resolveDefaultWorkspaceForApp } from "./workspaces";

describe("workspace service", () => {
  test("validates workspace numbers from numeric input", () => {
    expect(normalizeWorkspaceNumber(1)).toBe(1);
    expect(normalizeWorkspaceNumber("5")).toBe(5);
    expect(() => normalizeWorkspaceNumber(0)).toThrow("Workspace invalido.");
    expect(() => normalizeWorkspaceNumber(6)).toThrow("Workspace invalido.");
  });

  test("focuses a Sway workspace by known name", async () => {
    const calls: Array<[string, string[]]> = [];
    const service = createWorkspaceService({
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      commandExists: (command) => command === "swaymsg",
      spawnCommand: (command, args) => calls.push([command, args]),
    });

    await expect(service.focusWorkspace({ workspace: 3 })).resolves.toMatchObject({
      ok: true,
      activeWorkspace: 3,
    });
    expect(calls).toEqual([["swaymsg", ["workspace", "3:web"]]]);
  });

  test("returns a structured failure outside Sway", async () => {
    const service = createWorkspaceService({ env: {}, commandExists: () => true });
    await expect(service.focusWorkspace({ workspace: 2 })).resolves.toEqual({
      ok: false,
      message: "No hay una sesion Sway disponible para cambiar de workspace.",
      workspaces: service.listWorkspaces().workspaces,
    });
  });

  test("resolves app defaults", () => {
    expect(resolveDefaultWorkspaceForApp("terminal")).toBe(5);
    expect(resolveDefaultWorkspaceForApp("browser")).toBe(3);
    expect(resolveDefaultWorkspaceForApp("org.videolan.VLC")).toBe(2);
  });
});
