import { describe, expect, test } from "bun:test";
import { createBrowserTool, normalizeBrowserUrl } from "./browser";

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

  test("opens normalized urls through xdg-open", async () => {
    const calls: Array<[string, string[]]> = [];
    const tool = createBrowserTool({
      spawnCommand: (command, args) => {
        calls.push([command, args]);
      },
    });

    await expect(tool.openUrl("netflix.com")).resolves.toEqual({
      ok: true,
      message: "Abriendo https://netflix.com/.",
    });
    expect(calls).toEqual([["xdg-open", ["https://netflix.com/"]]]);
  });
});
