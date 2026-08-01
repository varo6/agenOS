import { describe, expect, test } from "bun:test";
import { createOpenFileModelTool } from "./file-open-tool";

describe("files_open model tool", () => {
  test("forwards launcher progress to Pi tool updates", async () => {
    const updates: string[] = [];
    const tool = createOpenFileModelTool({
      async openPath(input, options) {
        options?.onProgress?.("Esperando la aplicación del archivo…");
        return {
          ok: true,
          path: typeof input === "string" ? input : String(input.path),
          status: "mapped",
          message: "La foto ya está visible.",
        };
      },
    });

    const result = await tool.execute(
      "tool_1",
      { path: "/tmp/photo.png", workspace: 4, focus: true },
      undefined,
      (update) => updates.push(update.content[0]?.text ?? ""),
    );

    expect(updates).toEqual(["Esperando la aplicación del archivo…"]);
    expect(result.details).toMatchObject({ ok: true, status: "mapped" });
  });
});
