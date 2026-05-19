import { describe, expect, test } from "bun:test";
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
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openApp("Chrome")).resolves.toEqual({
      ok: true,
      appId: "browser",
      message: "Abriendo Chrome.",
    });
    expect(calls).toEqual([["/usr/bin/chromium", []]]);
  });

  test("rejects unknown apps instead of running arbitrary commands", async () => {
    const tool = createAppTool({
      commandExists: () => true,
      spawnCommand: () => {
        throw new Error("should not spawn");
      },
    });

    await expect(tool.openApp("rm -rf /")).resolves.toEqual({
      ok: false,
      message: "No conozco esa aplicacion. Prueba con Chrome, navegador, terminal o archivos.",
    });
  });
});
