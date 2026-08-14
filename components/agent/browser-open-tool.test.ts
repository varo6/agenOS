import { describe, expect, test } from "bun:test";
import { createOpenBrowserModelTool } from "./browser-open-tool";

describe("browser_open model tool", () => {
  test("opens a named website URL and streams launch progress", async () => {
    const calls: Array<{ url: string; workspace: unknown; focus: boolean | undefined }> = [];
    const updates: string[] = [];
    const tool = createOpenBrowserModelTool(async (url, options) => {
      calls.push({ url, workspace: options?.workspace, focus: options?.focus });
      options?.onProgress?.("Esperando la ventana de Chromium…");
      return {
        ok: true,
        status: "mapped",
        command: "chromium",
        args: [url],
        url: "https://www.youtube.com/",
        message: "Chromium ya está visible en el workspace 3:web.",
        platform: "wayland",
        profileDir: "/tmp/profile",
        profileCreated: false,
        securityDegraded: false,
        graphicsDegraded: false,
      };
    });

    const result = await tool.execute(
      "tool_1",
      { url: "https://www.youtube.com/", workspace: 3, focus: true },
      undefined,
      (update) => updates.push(update.content[0]?.text ?? ""),
    );

    expect(calls).toEqual([{ url: "https://www.youtube.com/", workspace: 3, focus: true }]);
    expect(updates).toEqual(["Esperando la ventana de Chromium…"]);
    expect(result.details).toMatchObject({ ok: true, status: "mapped", url: "https://www.youtube.com/" });
  });

  test("returns launcher errors as actionable tool output", async () => {
    const tool = createOpenBrowserModelTool(async () => {
      throw new Error("No encontré Chromium instalado.");
    });

    await expect(tool.execute("tool_1", { url: "https://example.com" })).resolves.toEqual({
      content: [{ type: "text", text: "No encontré Chromium instalado." }],
      details: { ok: false, message: "No encontré Chromium instalado." },
    });
  });
});
