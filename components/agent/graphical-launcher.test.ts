import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  launchGraphicalApplication,
  resolveExecutable,
  resolveTransientScopePrefix,
  type CommandRunResult,
  type SpawnedGraphicalProcess,
} from "./graphical-launcher";

function commandResult(overrides: Partial<CommandRunResult> = {}): CommandRunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function fakeChild(pid = 123): {
  child: SpawnedGraphicalProcess;
  processEvents: EventEmitter;
  stderrEvents: EventEmitter;
} {
  const processEvents = new EventEmitter();
  const stderrEvents = new EventEmitter();
  const child = processEvents as unknown as SpawnedGraphicalProcess;
  Object.assign(child, {
    pid,
    stderr: stderrEvents,
    unref() {},
  });
  return { child, processEvents, stderrEvents };
}

describe("graphical launcher", () => {
  test("resolves commands with the launch environment PATH", () => {
    const binDir = mkdtempSync(join(tmpdir(), "agenos-path-"));
    const executable = join(binDir, "demo-app");
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);

    expect(resolveExecutable(["demo-app"], { PATH: binDir })).toBe(executable);
    expect(resolveExecutable(["demo-app"], { PATH: "/missing" })).toBeUndefined();
  });

  test("moves and focuses only after a new Sway window maps", async () => {
    const calls: string[] = [];
    let treeReads = 0;
    const { child } = fakeChild(321);
    const result = await launchGraphicalApplication({
      command: "demo-app",
      args: ["--new-window"],
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      label: "Demo",
      workspace: 2,
      focus: true,
      windowTokens: ["demo"],
      commandExists: (command) => command === "swaymsg",
      spawnCommand: () => {
        calls.push("spawn");
        return child;
      },
      runCommand: async (_command, args) => {
        if (args[0] === "-t") {
          treeReads += 1;
          calls.push(`tree-${treeReads}`);
          return commandResult({
            stdout: treeReads === 1
              ? JSON.stringify({ nodes: [] })
              : JSON.stringify({ nodes: [{ id: 42, app_id: "demo", pid: 321 }] }),
          });
        }
        calls.push(args[0] ?? "");
        return commandResult();
      },
    });

    expect(result).toMatchObject({ ok: true, status: "mapped", windowId: 42 });
    expect(calls).toEqual([
      "tree-1",
      "spawn",
      "tree-2",
      '[con_id=42] move to workspace "2:app", focus',
    ]);
  });

  // El fullscreen tapa la swaybar, que es el unico sitio donde el usuario ve en
  // que escritorio esta. Por eso ya no se aplica por defecto fuera de 1:home:
  // solo cuando alguien lo pide explicitamente.
  test("only requests fullscreen when the caller asks for it", async () => {
    const swayCommands: string[] = [];
    let treeReads = 0;
    const { child } = fakeChild(321);
    const result = await launchGraphicalApplication({
      command: "demo-app",
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      label: "Demo",
      workspace: 3,
      focus: true,
      fullscreen: true,
      windowTokens: ["demo"],
      commandExists: (command) => command === "swaymsg",
      spawnCommand: () => child,
      runCommand: async (_command, args) => {
        if (args[0] === "-t") {
          treeReads += 1;
          return commandResult({
            stdout: treeReads === 1
              ? JSON.stringify({ nodes: [] })
              : JSON.stringify({ nodes: [{ id: 42, app_id: "demo", pid: 321 }] }),
          });
        }
        swayCommands.push(args[0] ?? "");
        return commandResult();
      },
    });

    expect(result).toMatchObject({ ok: true, status: "mapped" });
    expect(swayCommands).toEqual([
      '[con_id=42] move to workspace "3:web", fullscreen enable, focus',
    ]);
  });

  test("reports an early non-zero exit with captured stderr", async () => {
    const { child, processEvents, stderrEvents } = fakeChild();
    const resultPromise = launchGraphicalApplication({
      command: "broken-app",
      env: { DISPLAY: ":0" },
      label: "Broken",
      workspace: 2,
      focus: true,
      spawnCommand: () => {
        queueMicrotask(() => {
          stderrEvents.emit("data", "missing shared library\n");
          processEvents.emit("exit", 127, null);
        });
        return child;
      },
      coldStartMs: 5,
    });

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      status: "failed",
      exitCode: 127,
      stderr: "missing shared library",
    });
    expect((await resultPromise).message).toContain("código 127");
    expect((await resultPromise).message).toContain("missing shared library");
  });

  test("returns an actionable timeout when no Sway window appears", async () => {
    const progress: string[] = [];
    const result = await launchGraphicalApplication({
      command: "silent-app",
      env: { SWAYSOCK: "/run/user/1000/sway.sock" },
      label: "Silent",
      workspace: 2,
      focus: true,
      commandExists: (command) => command === "swaymsg",
      spawnCommand: () => undefined,
      runCommand: async () => commandResult({ stdout: JSON.stringify({ nodes: [] }) }),
      windowTimeoutMs: 5,
      pollIntervalMs: 1,
      coldStartMs: 0,
      onProgress: (message) => progress.push(message),
    });

    expect(result).toMatchObject({ ok: false, status: "timed-out" });
    expect(result.message).toContain("no apareció ninguna ventana en Sway");
    expect(progress.some((message) => message.includes("sigo esperando"))).toBe(true);
  });
});

describe("transient scope", () => {
  const userManagerAvailable = {
    env: { XDG_RUNTIME_DIR: "/run/user/1000" },
    commandExists: (command: string) => command === "systemd-run",
    pathExists: (path: string) => path === "/run/user/1000/systemd/private",
  };

  test("wraps the launch when there is a user systemd manager", () => {
    expect(resolveTransientScopePrefix(userManagerAvailable)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--collect",
      "--quiet",
      "--",
    ]);
  });

  test("launches without a scope when systemd-run or the user manager is missing", () => {
    expect(resolveTransientScopePrefix({
      ...userManagerAvailable,
      commandExists: () => false,
    })).toEqual([]);
    expect(resolveTransientScopePrefix({
      ...userManagerAvailable,
      pathExists: () => false,
    })).toEqual([]);
    expect(resolveTransientScopePrefix({
      ...userManagerAvailable,
      env: {},
    })).toEqual([]);
  });

  test("spawns the window inside its own scope but reports the real command", async () => {
    const spawned: Array<[string, string[]]> = [];
    const result = await launchGraphicalApplication({
      command: "/usr/bin/chromium",
      args: ["--new-window", "https://example.com/"],
      env: { XDG_RUNTIME_DIR: "/run/user/1000" },
      label: "Chromium",
      workspace: 3,
      focus: true,
      commandExists: (command) => command === "systemd-run" || command === "/usr/bin/chromium",
      pathExists: (path) => path === "/run/user/1000/systemd/private",
      spawnCommand: (command, args) => {
        spawned.push([command, args]);
      },
      coldStartMs: 0,
    });

    expect(spawned).toEqual([[
      "systemd-run",
      [
        "--user",
        "--scope",
        "--collect",
        "--quiet",
        "--",
        "/usr/bin/chromium",
        "--new-window",
        "https://example.com/",
      ],
    ]]);
    // El resultado sigue describiendo el programa real: los mensajes al usuario
    // y la deteccion de ventana no deben saber nada del scope.
    expect(result).toMatchObject({
      ok: true,
      command: "/usr/bin/chromium",
      args: ["--new-window", "https://example.com/"],
    });
  });

  test("keeps the plain spawn when the caller opts out", async () => {
    const spawned: Array<[string, string[]]> = [];
    await launchGraphicalApplication({
      command: "/usr/bin/chromium",
      args: ["--new-window"],
      env: { XDG_RUNTIME_DIR: "/run/user/1000" },
      label: "Chromium",
      workspace: 3,
      focus: true,
      escapeServiceCgroup: false,
      commandExists: () => true,
      pathExists: () => true,
      spawnCommand: (command, args) => {
        spawned.push([command, args]);
      },
      coldStartMs: 0,
    });

    expect(spawned).toEqual([["/usr/bin/chromium", ["--new-window"]]]);
  });
});
