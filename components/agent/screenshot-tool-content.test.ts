import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SCREENSHOT_BYTES, screenshotToolContent, screenshotVisionAllowed } from "./screenshot-tool-content";

describe("screenshotToolContent", () => {
  test("no carga ni adjunta capturas que superan el límite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenos-screenshot-content-"));
    const path = join(directory, "grande.png");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await truncate(path, MAX_SCREENSHOT_BYTES + 1);

    try {
      const content = await screenshotToolContent({ ok: true, message: "Captura guardada.", path });

      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text).toContain("Captura guardada.");
      expect(content[0]?.text).toContain("supera el límite de 5 MiB");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe("screenshotVisionAllowed", () => {
  test("adjunta cuando el contexto no dice nada del modelo", () => {
    expect(screenshotVisionAllowed(undefined, {})).toBe(true);
    expect(screenshotVisionAllowed({}, {})).toBe(true);
    expect(screenshotVisionAllowed({ model: {} }, {})).toBe(true);
  });

  test("no adjunta si el modelo activo solo acepta texto", () => {
    expect(screenshotVisionAllowed({ model: { input: ["text"] } }, {})).toBe(false);
    expect(screenshotVisionAllowed({ model: { input: ["text", "image"] } }, {})).toBe(true);
  });

  test("AGENOS_TOOL_VISION=off desactiva la visión aunque el modelo la acepte", () => {
    expect(screenshotVisionAllowed({ model: { input: ["image"] } }, { AGENOS_TOOL_VISION: "off" })).toBe(false);
    expect(screenshotVisionAllowed({ model: { input: ["image"] } }, { AGENOS_TOOL_VISION: "auto" })).toBe(true);
  });

  test("con la visión apagada devuelve solo el texto y no lee el PNG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenos-screenshot-vision-"));
    const path = join(directory, "captura.png");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    try {
      const content = await screenshotToolContent(
        { ok: true, message: `Captura guardada en ${path}.`, path },
        { ctx: { model: { input: ["text"] } }, env: {} },
      );

      expect(content).toEqual([{ type: "text", text: `Captura guardada en ${path}.` }]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
