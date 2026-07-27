import { describe, expect, test } from "bun:test";
import {
  createWorkspaceService,
  normalizeWorkspaceNumber,
  parseWorkspaceFocusEvent,
  resolveDefaultWorkspaceForApp,
} from "./workspaces";

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
      runCommandSync: (command, args) => {
        calls.push([command, args]);
        return args[0] === "workspace"
          ? '[{"success":true}]'
          : '[{"name":"3:web","focused":true}]';
      },
    });

    await expect(service.focusWorkspace({ workspace: 3 })).resolves.toMatchObject({
      ok: true,
      activeWorkspace: 3,
    });
    expect(calls).toEqual([
      ["swaymsg", ["workspace", "3:web"]],
      ["swaymsg", ["-t", "get_workspaces"]],
    ]);
  });

  test("fails when Sway does not confirm the requested workspace", async () => {
    const service = createWorkspaceService({
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      commandExists: (command) => command === "swaymsg",
      runCommandSync: (_command, args) => args[0] === "workspace"
        ? '[{"success":true}]'
        : '[{"name":"1:home","focused":true}]',
    });

    await expect(service.focusWorkspace({ workspace: 2 })).resolves.toMatchObject({
      ok: false,
      activeWorkspace: 1,
      message: "Sway no confirmo el cambio al workspace 2.",
    });
  });

  test("waits for a detached launcher focus command before returning", () => {
    const calls: Array<[string, string[]]> = [];
    let reads = 0;
    const service = createWorkspaceService({
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      commandExists: (command) => command === "swaymsg",
      spawnCommand: (command, args) => calls.push([command, args]),
      queryCommandSync: () => {
        reads += 1;
        return reads < 3
          ? '[{"name":"1:home","focused":true}]'
          : '[{"name":"5:work","focused":true}]';
      },
    });

    expect(service.focusWorkspaceSync({ workspace: 5, source: "system" })).toMatchObject({
      ok: true,
      activeWorkspace: 5,
    });
    expect(calls).toEqual([["swaymsg", ["workspace", "5:work"]]]);
    expect(reads).toBe(3);
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

  test("parses only real Sway workspace focus events", () => {
    expect(parseWorkspaceFocusEvent('{"change":"focus","current":{"name":"4:media"}}')).toBe(4);
    expect(parseWorkspaceFocusEvent('{"change":"init","current":{"name":"4:media"}}')).toBeUndefined();
    expect(parseWorkspaceFocusEvent('{"change":"focus","container":{"name":"4:media"}}')).toBeUndefined();
    expect(parseWorkspaceFocusEvent("not-json")).toBeUndefined();
  });

  test("pushes the initial and subsequent active workspace states", () => {
    let emitLine: ((line: string) => void) | undefined;
    let stopped = false;
    const service = createWorkspaceService({
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      commandExists: (command) => command === "swaymsg",
      runCommandSync: () => '[{"name":"1:home","focused":true}]',
      subscribeCommand: (onLine) => {
        emitLine = onLine;
        return () => {
          stopped = true;
        };
      },
    });
    const active: Array<number | undefined> = [];

    const unsubscribe = service.subscribeWorkspaceChanges((state) => {
      active.push(state.activeWorkspace);
    });
    emitLine?.('{"change":"focus","current":{"name":"5:work"}}');

    expect(active).toEqual([1, 5]);
    unsubscribe();
    expect(stopped).toBe(true);
  });
});
