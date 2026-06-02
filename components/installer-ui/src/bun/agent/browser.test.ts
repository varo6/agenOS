import { describe, expect, test } from "bun:test";
import { createBrowserTool, normalizeBrowserUrl } from "./browser";
import { launchBrowserUrl } from "../../../../agent/browser-launcher";

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

  test("opens normalized urls through Chromium launcher", async () => {
    const opened: string[] = [];
    const tool = createBrowserTool({
      browserLauncher: (url) => {
        opened.push(url);
        return { command: "chromium", args: ["--new-window", "https://netflix.com/"], url: "https://netflix.com/" };
      },
    });

    await expect(tool.openUrl("netflix.com")).resolves.toEqual({
      ok: true,
      message: "Abriendo https://netflix.com/.",
    });
    expect(opened).toEqual(["netflix.com"]);
  });

  test("passes workspace focus options to Chromium launcher", () => {
    const calls: Array<[string, string[]]> = [];
    const result = launchBrowserUrl("example.com", {
      env: { WAYLAND_DISPLAY: "wayland-1", SWAYSOCK: "/tmp/sway.sock" },
      workspace: 3,
      focus: true,
      commandExists: (command) => command === "chromium" || command === "swaymsg",
      spawnCommand: (command, args) => calls.push([command, args]),
    });

    expect(result.url).toBe("https://example.com/");
    expect(calls[0]).toEqual(["swaymsg", ["workspace", "3:web"]]);
    expect(calls[1]?.[0]).toBe("chromium");
  });
});
