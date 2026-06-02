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
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openApp("Chrome")).resolves.toEqual({
      ok: true,
      appId: "browser",
      displayName: "Chrome",
      message: "Abriendo Chrome.",
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

  test("focuses explicit workspace before opening apps", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => command === "foot" || command === "swaymsg",
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openApp({ app: "terminal", workspace: 5, focus: true })).resolves.toMatchObject({ ok: true });
    expect(calls[0]).toEqual(["swaymsg", ["workspace", "5:work"]]);
    expect(calls[1]).toEqual(["foot", []]);
  });

  test("uses app default workspace when none is provided", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => command === "foot" || command === "swaymsg",
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await tool.openApp("terminal");
    expect(calls[0]).toEqual(["swaymsg", ["workspace", "5:work"]]);
  });

  test("installs packages with apt and can open them afterwards", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      skipAptUpdate: true,
      commandExists: (command) => ["apt-get", "sudo", "vlc"].includes(command),
      runCommand: async (command, args) => {
        calls.push([command, args]);
        return {
          exitCode: 0,
          signal: null,
          stdout: "installed",
          stderr: "",
        };
      },
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.installApp("vlc", { openAfterInstall: true })).resolves.toMatchObject({
      ok: true,
      packageName: "vlc",
    });
    expect(calls.some(([, args]) => args.includes("install") && args.includes("vlc"))).toBe(true);
  });

  test("falls back to pkexec when sudo cannot run non-interactively", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createAppTool({
      skipAptUpdate: true,
      commandExists: (command) => ["apt-get", "sudo", "pkexec"].includes(command),
      runCommand: async (command, args) => {
        calls.push([command, args]);
        if (command === "sudo") {
          return {
            exitCode: 1,
            signal: null,
            stdout: "",
            stderr: "sudo: a password is required",
          };
        }

        return {
          exitCode: 0,
          signal: null,
          stdout: "installed",
          stderr: "",
        };
      },
    });

    await expect(tool.installApp("gimp", { openAfterInstall: false })).resolves.toMatchObject({
      ok: true,
      packageName: "gimp",
    });
    expect(calls).toEqual([
      ["sudo", ["-n", "apt-get", "install", "-y", "--", "gimp"]],
      ["pkexec", ["apt-get", "install", "-y", "--", "gimp"]],
    ]);
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
