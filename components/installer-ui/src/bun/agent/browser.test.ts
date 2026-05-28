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
});
