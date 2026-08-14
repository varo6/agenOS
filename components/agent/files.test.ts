import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTool } from "./files";

describe("file launcher", () => {
  test("waits for a mapped handler window before moving and focusing it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenos-file-"));
    const path = join(dir, "photo.png");
    writeFileSync(path, "image");
    const spawned: Array<[string, string[]]> = [];
    const swayCommands: string[] = [];
    let treeReads = 0;
    const tool = createFileTool({
      env: { SWAYSOCK: "/tmp/sway.sock" },
      commandExists: (command) => command === "xdg-open" || command === "swaymsg",
      spawnCommand: (command, args) => spawned.push([command, args]),
      runCommand: async (_command, args) => {
        if (args[0] === "-t") {
          treeReads += 1;
          return {
            exitCode: 0,
            signal: null,
            stdout: treeReads === 1
              ? JSON.stringify({ nodes: [{ id: 1, app_id: "agenos-system-ui", focused: true }] })
              : JSON.stringify({ nodes: [{ id: 1, app_id: "agenos-system-ui" }, { id: 77, app_id: "imv", focused: true }] }),
            stderr: "",
          };
        }
        swayCommands.push(args[0] ?? "");
        return { exitCode: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    await expect(tool.openPath(path)).resolves.toMatchObject({ ok: true, status: "mapped", path });
    expect(spawned).toEqual([["xdg-open", [path]]]);
    expect(swayCommands).toEqual(['[con_id=77] move to workspace "4:media", focus']);
  });

  test("reports a missing desktop opener instead of failing silently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenos-file-"));
    const path = join(dir, "document.pdf");
    writeFileSync(path, "pdf");
    const tool = createFileTool({
      env: { WAYLAND_DISPLAY: "wayland-1" },
      commandExists: () => false,
    });

    await expect(tool.openPath(path)).resolves.toEqual({
      ok: false,
      path,
      message: "No encontré xdg-open ni gio para abrir el archivo. Instala xdg-utils o libglib2.0-bin.",
    });
  });
});
