import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopControlModelTool } from "./desktop-control-tool";
import type {
  DesktopCapabilitiesResult,
  DesktopInspectResult,
  DesktopWindow,
} from "./desktop-control";

function window(overrides: Partial<DesktopWindow> = {}): DesktopWindow {
  return {
    id: 7,
    appId: "libreoffice-writer",
    title: "carta.odt — LibreOffice Writer",
    workspace: "2:app",
    focused: false,
    floating: false,
    geometry: { x: 0, y: 20, width: 960, height: 1060 },
    ...overrides,
  };
}

function inspection(overrides: Partial<DesktopInspectResult> = {}): DesktopInspectResult {
  const focused = window({ focused: true });
  return {
    ok: true,
    message: "Ventanas abiertas (1)",
    windows: [focused],
    focusedWindow: focused,
    workspaces: [{ name: "2:app", focused: true, windows: 1 }],
    outputs: [],
    summary: "Ventanas abiertas (1)",
    ...overrides,
  };
}

type Call = { method: string; args: unknown[] };

function fakeController(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const record = (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };

  const controller = {
    inspect: record("inspect", inspection()),
    focusWindow: record("focusWindow", { ok: true, message: "Ventana 7 enfocada.", id: 7 }),
    closeWindow: record("closeWindow", { ok: true, message: "Pedi a la ventana 7 que se cierre.", id: 7 }),
    typeText: record("typeText", { ok: true, message: "Escribi 4 caracteres en la ventana enfocada." }),
    pressKeys: record("pressKeys", { ok: true, message: "Pulse ctrl+s en la ventana enfocada.", combo: "ctrl+s" }),
    moveMouse: record("moveMouse", { ok: true, message: "Raton en (10, 20).", x: 10, y: 20 }),
    click: record("click", { ok: true, message: "Clic left en (10, 20)." }),
    scroll: record("scroll", { ok: true, message: "Envie 3 pasos de rueda hacia abajo." }),
    screenshot: record("screenshot", { ok: true, message: "Captura guardada.", path: "/home/u/Fotos/a.png" }),
    capabilities: record("capabilities", {
      ok: true,
      message: "Todo disponible.",
      summary: "Todo disponible.",
      graphicalSession: true,
      commands: { swaymsg: true, wtype: true, ydotool: true, grim: true },
      ydotoolDaemon: true,
      missing: [],
    } satisfies DesktopCapabilitiesResult),
    ...overrides,
  };

  return { controller: controller as never, calls };
}

describe("desktop_control model tool", () => {
  test("describe la herramienta con el nombre y las guias esperadas", () => {
    const { controller } = fakeController();
    const tool = createDesktopControlModelTool(controller);

    expect(tool.name).toBe("desktop_control");
    expect(tool.label).toBe("Manejar el escritorio");
    const parameters = tool.parameters as { properties: { action: { enum: string[] } }; required: string[] };
    expect(parameters.properties.action.enum).toEqual([
      "inspect",
      "focus",
      "close",
      "type",
      "keys",
      "mouse_move",
      "click",
      "scroll",
      "screenshot",
      "capabilities",
    ]);
    expect(parameters.required).toEqual(["action"]);
    const guidelines = tool.promptGuidelines.join(" ");
    expect(guidelines).toContain("web_control");
    expect(guidelines).toContain("inspect");
    expect(guidelines).toContain("LibreOffice");
  });

  test("inspect devuelve el resumen sin llamar dos veces", async () => {
    const { controller, calls } = fakeController();
    const tool = createDesktopControlModelTool(controller);

    const result = await tool.execute("call_1", { action: "inspect" });

    expect(calls.map((call) => call.method)).toEqual(["inspect"]);
    expect(result.content[0]?.text).toContain("Ventanas abiertas (1)");
    expect(result.details).toMatchObject({ action: "inspect", ok: true });
  });

  test("tras focus, type, keys y click anade el estado del foco", async () => {
    for (const params of [
      { action: "focus", id: 7 },
      { action: "type", text: "hola" },
      { action: "keys", combo: "ctrl+s" },
      { action: "click", x: 10, y: 20 },
    ]) {
      const { controller, calls } = fakeController();
      const tool = createDesktopControlModelTool(controller);

      const result = await tool.execute("call_1", params);

      expect(calls.at(-1)?.method).toBe("inspect");
      expect(result.content[0]?.text).toContain("la ventana enfocada es id 7 (libreoffice-writer");
      expect(result.details).toMatchObject({ action: params.action, ok: true });
    }
  });

  test("no vuelve a inspeccionar tras acciones sin efecto sobre el foco", async () => {
    const { controller, calls } = fakeController();
    const tool = createDesktopControlModelTool(controller);

    await tool.execute("call_1", { action: "screenshot" });
    await tool.execute("call_2", { action: "close", id: 7 });
    await tool.execute("call_3", { action: "capabilities" });

    expect(calls.map((call) => call.method)).toEqual(["screenshot", "closeWindow", "capabilities"]);
  });

  test("screenshot devuelve el mensaje y el PNG al modelo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenos-desktop-tool-"));
    const path = join(directory, "captura.png");
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("contenido de prueba"),
    ]);
    await writeFile(path, png);

    try {
      const { controller } = fakeController({
        screenshot: async () => ({ ok: true, message: `Captura guardada en ${path}.`, path }),
      });
      const result = await createDesktopControlModelTool(controller).execute("call_image", { action: "screenshot" });

      expect(result.content).toEqual([
        { type: "text", text: `Captura guardada en ${path}.` },
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      ]);
      expect(result.details).toEqual({ action: "screenshot", ok: true, message: `Captura guardada en ${path}.`, path });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("screenshot conserva el texto si no puede leer la imagen", async () => {
    const path = join(tmpdir(), "agenos-captura-inexistente.png");
    const { controller } = fakeController({
      screenshot: async () => ({ ok: true, message: `Captura guardada en ${path}.`, path }),
    });

    const result = await createDesktopControlModelTool(controller).execute("call_missing", { action: "screenshot" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toContain(`Captura guardada en ${path}.`);
    expect(result.content[0]?.text).toContain("No pude leer la captura");
  });

  test("reenvia los parametros a los metodos del controlador", async () => {
    const { controller, calls } = fakeController();
    const tool = createDesktopControlModelTool(controller);

    await tool.execute("call_1", { action: "mouse_move", x: 10, y: 20 });
    await tool.execute("call_2", { action: "click", button: "right", double: true, x: 5, y: 6 });
    await tool.execute("call_3", { action: "scroll", direction: "down", amount: 5 });
    await tool.execute("call_4", { action: "screenshot", path: "~/Fotos/x.png" });

    const byMethod = (method: string) => calls.find((call) => call.method === method)?.args;
    expect(byMethod("moveMouse")).toEqual([10, 20]);
    expect(byMethod("click")).toEqual(["right", { x: 5, y: 6, double: true }]);
    expect(byMethod("scroll")).toEqual(["down", 5]);
    expect(byMethod("screenshot")).toEqual(["~/Fotos/x.png"]);
  });

  test("rechaza acciones desconocidas sin tocar el escritorio", async () => {
    const { controller, calls } = fakeController();
    const tool = createDesktopControlModelTool(controller);

    const result = await tool.execute("call_1", { action: "explotar" });

    expect(calls).toEqual([]);
    expect(result.content[0]?.text).toContain("Accion no valida");
    expect(result.details).toMatchObject({ ok: false });
  });

  test("pide la direccion cuando falta en scroll", async () => {
    const { controller, calls } = fakeController();
    const tool = createDesktopControlModelTool(controller);

    const result = await tool.execute("call_1", { action: "scroll" });

    expect(calls).toEqual([]);
    expect(result.content[0]?.text).toContain("'up' o 'down'");
  });

  test("propaga los fallos del controlador tal cual, sin inventar exito", async () => {
    const { controller } = fakeController({
      typeText: async () => ({
        ok: false,
        message: "Falta el binario 'wtype' (paquete wtype) en el sistema, asi que no puedo escribir texto.",
      }),
    });
    const tool = createDesktopControlModelTool(controller);

    const result = await tool.execute("call_1", { action: "type", text: "hola" });

    expect(result.details).toMatchObject({ ok: false });
    expect(result.content[0]?.text).toContain("paquete wtype");
  });

  test("sobrevive a un controlador que lanza", async () => {
    const { controller } = fakeController({
      inspect: async () => {
        throw new Error("swaymsg desaparecio");
      },
    });
    const tool = createDesktopControlModelTool(controller);

    const result = await tool.execute("call_1", { action: "inspect" });

    expect(result.details).toMatchObject({ ok: false, action: "inspect" });
    expect(result.content[0]?.text).toContain("swaymsg desaparecio");
  });

  test("avisa si no puede confirmar el foco despues de actuar", async () => {
    const { controller } = fakeController({
      inspect: async () => inspection({ ok: false, message: "No hay sesion grafica.", windows: [], focusedWindow: undefined }),
    });
    const tool = createDesktopControlModelTool(controller);

    const result = await tool.execute("call_1", { action: "focus", id: 7 });

    expect(result.content[0]?.text).toContain("No pude comprobar como quedo el escritorio");
  });
});
