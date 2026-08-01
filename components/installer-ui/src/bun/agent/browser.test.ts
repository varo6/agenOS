import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserTool, normalizeBrowserUrl } from "./browser";
import {
  launchBrowserUrl,
  resolveBrowserPlatform,
  type BrowserLaunchResult,
} from "../../../../agent/browser-launcher";

function successfulBrowserResult(url: string): BrowserLaunchResult {
  return {
    ok: true,
    status: "mapped",
    command: "chromium",
    args: ["--new-window", url],
    url,
    message: "Chromium ya está visible en el workspace 3:web.",
    platform: "wayland",
    profileDir: "/tmp/profile",
    profileCreated: false,
    securityDegraded: false,
    graphicsDegraded: false,
  };
}

describe("browser tool", () => {
  test("adds https to plain domains", () => {
    expect(normalizeBrowserUrl("netflix.com")).toBe("https://netflix.com/");
  });

  test("keeps valid http urls", () => {
    expect(normalizeBrowserUrl("https://example.com/watch")).toBe("https://example.com/watch");
  });

  test("rejects non-http protocols", () => {
    expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow("Solo se permiten URLs http o https.");
  });

  test("returns the verified Chromium launch result", async () => {
    const opened: string[] = [];
    const tool = createBrowserTool({
      browserLauncher: async (url) => {
        opened.push(url);
        return successfulBrowserResult("https://netflix.com/");
      },
    });

    await expect(tool.openUrl("netflix.com")).resolves.toEqual({
      ok: true,
      status: "mapped",
      message: "Chromium ya está visible en el workspace 3:web.",
    });
    expect(opened).toEqual(["netflix.com"]);
  });

  test("uses native Wayland and focuses only after Chromium maps", async () => {
    const spawned: Array<[string, string[]]> = [];
    const swayCommands: string[] = [];
    let treeReads = 0;
    const profileDir = join(mkdtempSync(join(tmpdir(), "agenos-browser-")), "profile");
    const result = await launchBrowserUrl("example.com", {
      env: { WAYLAND_DISPLAY: "wayland-1", SWAYSOCK: "/tmp/sway.sock" },
      profileDir,
      workspace: 3,
      focus: true,
      uid: 1000,
      commandExists: (command) => command === "chromium" || command === "swaymsg",
      spawnCommand: (command, args) => {
        spawned.push([command, args]);
      },
      runCommand: async (_command, args) => {
        if (args[0] === "-t") {
          treeReads += 1;
          return {
            exitCode: 0,
            signal: null,
            stdout: treeReads === 1
              ? JSON.stringify({ nodes: [] })
              : JSON.stringify({ nodes: [{ id: 51, app_id: "chromium", pid: 900 }] }),
            stderr: "",
          };
        }
        swayCommands.push(args[0] ?? "");
        return { exitCode: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "mapped",
      url: "https://example.com/",
      platform: "wayland",
      profileCreated: true,
      securityDegraded: false,
      graphicsDegraded: false,
    });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[1]).toContain("--ozone-platform=wayland");
    expect(spawned[0]?.[1]).not.toContain("--ozone-platform-hint=auto");
    expect(spawned[0]?.[1]).not.toContain("--no-sandbox");
    expect(swayCommands).toEqual(['[con_id=51] move to workspace "3:web", fullscreen enable, focus']);
  });

  test("uses the X11 backend for an XWayland-only session", async () => {
    const calls: string[][] = [];
    const profileDir = join(mkdtempSync(join(tmpdir(), "agenos-browser-")), "profile");
    const result = await launchBrowserUrl("example.com", {
      env: { DISPLAY: ":0", XDG_RUNTIME_DIR: "/definitely/missing" },
      profileDir,
      uid: 1000,
      commandExists: (command) => command === "chromium",
      spawnCommand: (_command, args) => calls.push(args),
      coldStartMs: 0,
    });

    expect(result).toMatchObject({ ok: true, status: "unverified", platform: "x11" });
    expect(calls[0]).toContain("--ozone-platform=x11");
    expect(resolveBrowserPlatform({ DISPLAY: ":0", XDG_RUNTIME_DIR: "/definitely/missing" })).toBe("x11");
  });

  test("falls back to XWayland after an early native Wayland failure", async () => {
    const calls: string[][] = [];
    const processEvents = new EventEmitter();
    const stderrEvents = new EventEmitter();
    Object.assign(processEvents, { pid: 456, stderr: stderrEvents, unref() {} });
    const profileDir = join(mkdtempSync(join(tmpdir(), "agenos-browser-")), "profile");
    let spawnCount = 0;
    const result = await launchBrowserUrl("example.com", {
      env: {
        WAYLAND_DISPLAY: "wayland-1",
        DISPLAY: ":0",
        XDG_RUNTIME_DIR: "/definitely/missing",
      },
      profileDir,
      uid: 1000,
      commandExists: (command) => command === "chromium",
      spawnCommand: (_command, args) => {
        spawnCount += 1;
        calls.push(args);
        if (spawnCount === 1) {
          queueMicrotask(() => {
            stderrEvents.emit("data", "Wayland connection failed");
            processEvents.emit("exit", 1, null);
          });
          return processEvents;
        }
        return undefined;
      },
      coldStartMs: 5,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--ozone-platform=wayland");
    expect(calls[1]).toContain("--ozone-platform=x11");
    expect(result).toMatchObject({ ok: true, status: "unverified", platform: "x11" });
    expect(result.message).toContain("XWayland como respaldo");
  });

  test("uses software rendering when Sway itself fell back to pixman", async () => {
    const calls: string[][] = [];
    const profileDir = join(mkdtempSync(join(tmpdir(), "agenos-browser-")), "profile");
    const result = await launchBrowserUrl("example.com", {
      env: { DISPLAY: ":0", XDG_RUNTIME_DIR: "/definitely/missing", WLR_RENDERER: "pixman" },
      profileDir,
      uid: 1000,
      commandExists: (command) => command === "chromium",
      spawnCommand: (_command, args) => calls.push(args),
      coldStartMs: 0,
    });

    expect(result.graphicsDegraded).toBe(true);
    expect(calls[0]).toContain("--disable-gpu");
  });

  test("degrades explicitly to no-sandbox only when running as root", async () => {
    const calls: string[][] = [];
    const warnings: string[] = [];
    const profileDir = join(mkdtempSync(join(tmpdir(), "agenos-browser-")), "profile");
    const result = await launchBrowserUrl("example.com", {
      env: { DISPLAY: ":0", XDG_RUNTIME_DIR: "/definitely/missing" },
      profileDir,
      uid: 0,
      logger: { warn: (message) => warnings.push(String(message)) },
      commandExists: (command) => command === "chromium",
      spawnCommand: (_command, args) => calls.push(args),
      coldStartMs: 0,
    });

    expect(result.securityDegraded).toBe(true);
    expect(result.message).toContain("sin sandbox");
    expect(calls[0]).toContain("--no-sandbox");
    expect(warnings[0]).toContain("--no-sandbox");
  });

  test("returns actionable Spanish validation errors", async () => {
    const tool = createBrowserTool({
      browserLauncher: async () => {
        throw new Error("No encontré Chromium instalado.");
      },
    });

    await expect(tool.openUrl("example.com")).resolves.toEqual({
      ok: false,
      message: "No encontré Chromium instalado.",
    });
  });
});
