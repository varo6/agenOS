import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebControlModelTool } from "./web-control-tool";
import type { WebController } from "./web-control";

function fakeController(screenshot: WebController["screenshot"]): WebController {
  return {
    status: async () => ({ ok: true, connected: true, message: "Conectado." }),
    open: async () => ({ ok: true, message: "Abierto." }),
    snapshot: async () => ({ ok: true, message: "Leído.", text: "Página" }),
    click: async () => ({ ok: true, message: "Pulsado." }),
    type: async () => ({ ok: true, message: "Escrito." }),
    pressKey: async () => ({ ok: true, message: "Tecla pulsada." }),
    waitFor: async () => ({ ok: true, message: "Encontrado." }),
    extract: async () => ({ ok: true, message: "Extraído.", matches: [] }),
    screenshot,
    back: async () => ({ ok: true, message: "Atrás." }),
    reload: async () => ({ ok: true, message: "Recargado." }),
  };
}

describe("web_control model tool", () => {
  test("screenshot devuelve texto e ImageContent con los bytes de Chromium", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenos-web-tool-"));
    const path = join(directory, "pagina.png");
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("captura web de prueba"),
    ]);
    await writeFile(path, png);

    try {
      const controller = fakeController(async (receivedPath) => ({
        ok: true,
        message: `Guardé la captura de la página en ${path}.`,
        path,
        target: receivedPath,
      }));
      const result = await createWebControlModelTool(controller).execute("call_image", {
        action: "screenshot",
        path: "~/Fotos/pagina.png",
      });

      expect(result.content).toEqual([
        { type: "text", text: `Guardé la captura de la página en ${path}.` },
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      ]);
      expect(result.details).toEqual({
        ok: true,
        message: `Guardé la captura de la página en ${path}.`,
        path,
        target: "~/Fotos/pagina.png",
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("un modelo sin visión recibe la ruta en texto y ninguna imagen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenos-web-tool-sin-vision-"));
    const path = join(directory, "pagina.png");
    await writeFile(path, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("captura web de prueba"),
    ]));

    try {
      const controller = fakeController(async () => ({
        ok: true,
        message: `Guardé la captura de la página en ${path}.`,
        path,
      }));
      const result = await createWebControlModelTool(controller).execute(
        "call_texto",
        { action: "screenshot", path },
        undefined,
        undefined,
        { model: { id: "solo-texto", input: ["text"] } },
      );

      expect(result.content).toEqual([
        { type: "text", text: `Guardé la captura de la página en ${path}.` },
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("screenshot fallido sigue devolviendo solo el mensaje del controlador", async () => {
    const controller = fakeController(async () => ({
      ok: false,
      message: "Chromium no devolvió ninguna imagen para la captura.",
    }));

    const result = await createWebControlModelTool(controller).execute("call_failed", {
      action: "screenshot",
      path: "/tmp/pagina.png",
    });

    expect(result.content).toEqual([
      { type: "text", text: "Chromium no devolvió ninguna imagen para la captura." },
    ]);
  });
});
