import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppTool, normalizeAppName, sanitizeDesktopExec } from "./apps";

describe("app tool", () => {
  test("removes desktop field codes", () => {
    expect(sanitizeDesktopExec("chromium %U")).toEqual(["chromium"]);
  });

  test("preserves quoted arguments", () => {
    expect(sanitizeDesktopExec('chromium --new-window "https://netflix.com"')).toEqual([
      "chromium",
      "--new-window",
      "https://netflix.com",
    ]);
  });

  test("rejects empty exec lines", () => {
    expect(() => sanitizeDesktopExec("%U")).toThrow("El Exec del .desktop no contiene ningun comando ejecutable.");
  });

  test("normalizes Spanish launch aliases", () => {
    expect(normalizeAppName("el navegador")).toBe("navegador");
  });

  test("opens chrome through the first available safe command", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      commandExists: (command) => command === "/usr/bin/chromium",
      env: { WAYLAND_DISPLAY: "wayland-1" },
      homeDir: mkdtempSync(join(tmpdir(), "agenos-browser-home-")),
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openApp("Chrome")).resolves.toEqual({
      ok: true,
      appId: "browser",
      displayName: "Chrome",
      status: "unverified",
      message: "Inicié Chromium, pero esta sesión no expone Sway; no puedo confirmar ni ubicar su ventana.",
    });
    expect(calls[0]?.[0]).toBe("/usr/bin/chromium");
    expect(calls[0]?.[1]).toContain("https://www.google.com/");
  });

  test("opens installed desktop entries", async () => {
    const desktopDir = mkdtempSync(join(tmpdir(), "agenos-apps-"));
    writeFileSync(join(desktopDir, "org.videolan.VLC.desktop"), [
      "[Desktop Entry]",
      "Type=Application",
      "Name=VLC media player",
      "Name[es]=Reproductor multimedia VLC",
      "Exec=vlc --started-from-file %U",
      "",
    ].join("\n"));

    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      desktopDirs: [desktopDir],
      commandExists: (command) => command === "gtk-launch" || command === "vlc",
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openApp("VLC")).resolves.toMatchObject({
      ok: true,
      appId: "org.videolan.VLC",
      displayName: "Reproductor multimedia VLC",
    });
    expect(calls).toEqual([["gtk-launch", ["org.videolan.VLC"]]]);
  });

  test("does not focus an empty workspace when an app never maps", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => command === "foot" || command === "swaymsg",
      runCommand: async () => ({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "no tree",
      }),
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
      windowTimeoutMs: 5,
      pollIntervalMs: 1,
    });

    await expect(tool.openApp({ app: "terminal", workspace: 5, focus: true })).resolves.toMatchObject({
      ok: false,
      status: "timed-out",
    });
    expect(calls).toEqual([["foot", ["--app-id=agenos-terminal"]]]);
  });

  test("uses the app default workspace after its window maps", async () => {
    const calls: Array<[string, string[]]> = [];
    let treeReads = 0;
    const tool = createAppTool({
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => command === "foot" || command === "swaymsg",
      runCommand: async (command, args) => {
        calls.push([command, args]);
        if (args[0] === "-t") {
          treeReads += 1;
          return {
            exitCode: 0,
            signal: null,
            stdout: treeReads === 1
              ? JSON.stringify({ nodes: [] })
              : JSON.stringify({ nodes: [{ id: 12, app_id: "foot", pid: 55 }] }),
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openApp("terminal")).resolves.toMatchObject({ ok: true, status: "mapped" });
    expect(calls.at(-1)).toEqual(["swaymsg", ['[con_id=12] move to workspace "5:work", focus']]);
  });

  test("reports the process diagnostic when a mapped app cannot be queried", async () => {
    const tool = createAppTool({
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => command === "foot" || command === "swaymsg",
      runCommand: async () => ({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "no tree",
      }),
      spawnCommand: () => undefined,
      windowTimeoutMs: 5,
      pollIntervalMs: 1,
    });

    await expect(tool.openApp("terminal")).resolves.toMatchObject({
      ok: false,
      status: "timed-out",
      message: expect.stringContaining("no tree"),
    });
  });

  test("moves and focuses a discovered app window after desktop launch", async () => {
    const desktopDir = mkdtempSync(join(tmpdir(), "agenos-apps-"));
    writeFileSync(join(desktopDir, "org.mozilla.firefox.desktop"), [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Firefox",
      "Exec=firefox %u",
      "",
    ].join("\n"));

    const spawned: Array<[string, string[]]> = [];
    const swayCommands: Array<[string, string[]]> = [];
    let treeReads = 0;
    const tool = createAppTool({
      desktopDirs: [desktopDir],
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => ["gtk-launch", "firefox", "swaymsg"].includes(command),
      spawnCommand: (command, args) => {
        spawned.push([command, args]);
      },
      runCommand: async (command, args) => {
        swayCommands.push([command, args]);
        if (args[0] === "-t") {
          treeReads += 1;
          return {
            exitCode: 0,
            signal: null,
            stdout: treeReads === 1 ? JSON.stringify({ nodes: [] }) : JSON.stringify({
              nodes: [{
                type: "workspace",
                name: "3:web",
                nodes: [{
                  id: 42,
                  type: "con",
                  app_id: "org.mozilla.firefox",
                  pid: 1234,
                }],
              }],
            }),
            stderr: "",
          };
        }

        return {
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
      },
    });

    await expect(tool.openApp({ app: "Firefox", workspace: 3, focus: true })).resolves.toMatchObject({
      ok: true,
      status: "mapped",
      message: "Firefox ya está visible en el workspace 3:web.",
    });
    expect(spawned).toEqual([
      ["gtk-launch", ["org.mozilla.firefox"]],
    ]);
    expect(swayCommands.at(-1)).toEqual([
      "swaymsg",
      ['[con_id=42] move to workspace "3:web", focus'],
    ]);
  });

  test("does not expose generic package installation or privilege escalation", () => {
    const tool = createAppTool();

    expect("installApp" in tool).toBe(false);
  });

  test("rejects unknown apps instead of running arbitrary commands", async () => {
    const tool = createAppTool({
      desktopDirs: [],
      commandExists: () => true,
      spawnCommand: () => {
        throw new Error("should not spawn");
      },
    });

    await expect(tool.openApp("rm -rf /")).resolves.toEqual({
      ok: false,
      message: 'No encontre una aplicacion instalada llamada "rm -rf /". Apps disponibles: Chrome, Terminal, Archivos.',
    });
  });
});
