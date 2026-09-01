import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKeyComboArgs,
  createDesktopController,
  parseSwayTree,
  type DesktopRunResult,
} from "./desktop-control";

// Entorno con sesion grafica falsa. XDG_RUNTIME_DIR apunta a un directorio que
// no existe para que session-env no herede la sesion real de la maquina.
const GRAPHICAL_ENV = {
  XDG_RUNTIME_DIR: "/nonexistent-agenos-test",
  WAYLAND_DISPLAY: "wayland-1",
  SWAYSOCK: "/run/user/1000/sway-ipc.sock",
};

const HEADLESS_ENV = {
  XDG_RUNTIME_DIR: "/nonexistent-agenos-test",
};

function ok(stdout = ""): DesktopRunResult {
  return { ok: true, stdout, stderr: "", code: 0 };
}

function failure(stderr: string, code: number | null = 1): DesktopRunResult {
  return { ok: false, stdout: "", stderr, code };
}

const TIMED_OUT: DesktopRunResult = { ok: false, stdout: "", stderr: "", code: null };

// Arbol realista de Sway: root -> outputs -> workspaces -> contenedores anidados,
// con ventanas flotantes, una ventana XWayland (window_properties.class) y el
// scratchpad interno de Sway.
const SWAY_TREE = {
  id: 1,
  name: "root",
  type: "root",
  rect: { x: 0, y: 0, width: 1920, height: 1080 },
  nodes: [
    {
      id: 2,
      name: "__i3",
      type: "output",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      nodes: [
        {
          id: 3,
          name: "__i3_scratch",
          type: "workspace",
          focused: false,
          nodes: [],
          floating_nodes: [],
        },
      ],
      floating_nodes: [],
    },
    {
      id: 4,
      name: "HDMI-A-1",
      type: "output",
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      nodes: [
        {
          id: 5,
          name: "2:app",
          type: "workspace",
          focused: false,
          rect: { x: 0, y: 20, width: 1920, height: 1060 },
          nodes: [
            {
              id: 6,
              name: null,
              type: "con",
              layout: "splith",
              rect: { x: 0, y: 20, width: 1920, height: 1060 },
              nodes: [
                {
                  id: 7,
                  name: "carta.odt — LibreOffice Writer",
                  type: "con",
                  app_id: "libreoffice-writer",
                  pid: 900,
                  focused: false,
                  rect: { x: 0, y: 20, width: 960, height: 1060 },
                  nodes: [],
                  floating_nodes: [],
                },
                {
                  id: 8,
                  name: "GNU Image Manipulation Program",
                  type: "con",
                  app_id: null,
                  pid: 901,
                  focused: false,
                  window_properties: { class: "Gimp", title: "GNU Image Manipulation Program" },
                  rect: { x: 960, y: 20, width: 960, height: 1060 },
                  nodes: [],
                  floating_nodes: [],
                },
              ],
              floating_nodes: [],
            },
          ],
          floating_nodes: [
            {
              id: 9,
              name: "Control de volumen",
              type: "floating_con",
              app_id: "pavucontrol",
              pid: 902,
              focused: false,
              rect: { x: 400, y: 300, width: 600, height: 400 },
              nodes: [],
              floating_nodes: [],
            },
          ],
        },
        {
          id: 10,
          name: "3:web",
          type: "workspace",
          focused: true,
          rect: { x: 0, y: 20, width: 1920, height: 1060 },
          nodes: [
            {
              id: 11,
              name: "AgenOS — Chromium",
              type: "con",
              app_id: "chromium",
              pid: 903,
              focused: true,
              rect: { x: 0, y: 20, width: 1920, height: 1060 },
              nodes: [],
              floating_nodes: [],
            },
          ],
          floating_nodes: [],
        },
      ],
      floating_nodes: [],
    },
  ],
  floating_nodes: [],
};

const SWAY_OUTPUTS = [
  { name: "HDMI-A-1", active: true, focused: true, rect: { x: 0, y: 0, width: 1920, height: 1080 } },
];

function swayRunner(calls: Array<{ command: string; args: string[] }>) {
  return async (command: string, args: string[]): Promise<DesktopRunResult> => {
    calls.push({ command, args });
    if (command === "swaymsg" && args[1] === "get_tree") {
      return ok(JSON.stringify(SWAY_TREE));
    }
    if (command === "swaymsg" && args[1] === "get_outputs") {
      return ok(JSON.stringify(SWAY_OUTPUTS));
    }
    if (command === "swaymsg") {
      return ok('[{"success":true}]');
    }
    return ok();
  };
}

function controllerWith(
  runCommand: (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<DesktopRunResult>,
  overrides: Parameters<typeof createDesktopController>[0] = {},
) {
  return createDesktopController({
    env: GRAPHICAL_ENV,
    commandExists: () => true,
    runCommand,
    ...overrides,
  });
}

describe("parseSwayTree", () => {
  test("aplana el arbol completo, incluidos nodos anidados y flotantes", () => {
    const { windows, workspaces } = parseSwayTree(SWAY_TREE);

    expect(windows.map((window) => window.id)).toEqual([7, 8, 9, 11]);
    expect(windows[0]).toEqual({
      id: 7,
      appId: "libreoffice-writer",
      title: "carta.odt — LibreOffice Writer",
      workspace: "2:app",
      focused: false,
      floating: false,
      geometry: { x: 0, y: 20, width: 960, height: 1060 },
    });
    // Ventana XWayland: el nombre de la app sale de window_properties.class.
    expect(windows[1]).toMatchObject({ id: 8, appId: "Gimp", workspace: "2:app", floating: false });
    expect(windows[2]).toMatchObject({ id: 9, appId: "pavucontrol", floating: true, workspace: "2:app" });
    expect(windows[3]).toMatchObject({ id: 11, appId: "chromium", workspace: "3:web", focused: true });

    expect(workspaces).toEqual([
      { name: "2:app", focused: false, windows: 3 },
      { name: "3:web", focused: true, windows: 1 },
    ]);
  });

  test("no revienta con arboles vacios o basura", () => {
    expect(parseSwayTree(undefined).windows).toEqual([]);
    expect(parseSwayTree({ nodes: "no-es-una-lista" }).windows).toEqual([]);
  });
});

describe("buildKeyComboArgs", () => {
  test("traduce combos a los argumentos exactos de wtype", () => {
    expect(buildKeyComboArgs("ctrl+s").args).toEqual(["-M", "ctrl", "-k", "s", "-m", "ctrl"]);
    expect(buildKeyComboArgs("alt+Tab").args).toEqual(["-M", "alt", "-k", "Tab", "-m", "alt"]);
    // Los modificadores se sueltan en orden inverso al que se pulsaron.
    expect(buildKeyComboArgs("ctrl+shift+t").args).toEqual([
      "-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl",
    ]);
    expect(buildKeyComboArgs("Return").args).toEqual(["-k", "Return"]);
    expect(buildKeyComboArgs("Escape").args).toEqual(["-k", "Escape"]);
  });

  test("normaliza nombres humanos de teclas y modificadores", () => {
    expect(buildKeyComboArgs("enter").args).toEqual(["-k", "Return"]);
    expect(buildKeyComboArgs("esc").args).toEqual(["-k", "Escape"]);
    expect(buildKeyComboArgs("tab").args).toEqual(["-k", "Tab"]);
    expect(buildKeyComboArgs("del").args).toEqual(["-k", "Delete"]);
    expect(buildKeyComboArgs("abajo").args).toEqual(["-k", "Down"]);
    expect(buildKeyComboArgs("ctrl+f5").args).toEqual(["-M", "ctrl", "-k", "F5", "-m", "ctrl"]);
    expect(buildKeyComboArgs("super+izquierda").args).toEqual(["-M", "logo", "-k", "Left", "-m", "logo"]);
  });

  test("rechaza combos vacios o con modificadores inventados", () => {
    expect(buildKeyComboArgs("").ok).toBe(false);
    const invalid = buildKeyComboArgs("hiper+s");
    expect(invalid.ok).toBe(false);
    expect(invalid.message).toContain("hiper");
  });
});

describe("createDesktopController.inspect", () => {
  test("lee el arbol y las salidas y devuelve un resumen legible", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(swayRunner(calls));

    const result = await controller.inspect();

    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({ command: "swaymsg", args: ["-t", "get_tree", "-r"] });
    expect(calls[1]).toEqual({ command: "swaymsg", args: ["-t", "get_outputs", "-r"] });
    expect(result.windows).toHaveLength(4);
    expect(result.focusedWindow).toMatchObject({ id: 11, appId: "chromium" });
    expect(result.outputs).toEqual([
      { name: "HDMI-A-1", active: true, focused: true, geometry: { x: 0, y: 0, width: 1920, height: 1080 } },
    ]);
    expect(result.summary).toContain("Ventanas abiertas (4)");
    expect(result.summary).toContain("libreoffice-writer");
    expect(result.message).toContain("Ventana enfocada: id 11");
  });

  test("avisa cuando Sway devuelve algo que no es JSON", async () => {
    const controller = controllerWith(async () => ok("esto no es json"));
    const result = await controller.inspect();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no pude interpretar");
    expect(result.windows).toEqual([]);
  });
});

describe("createDesktopController: ventanas", () => {
  test("enfoca y cierra ventanas con la sintaxis de swaymsg", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(swayRunner(calls));

    await expect(controller.focusWindow(7)).resolves.toMatchObject({ ok: true, id: 7 });
    await expect(controller.closeWindow("9")).resolves.toMatchObject({ ok: true, id: 9 });

    expect(calls).toEqual([
      { command: "swaymsg", args: ["-r", "[con_id=7] focus"] },
      { command: "swaymsg", args: ["-r", "[con_id=9] kill"] },
    ]);
  });

  test("pide un id valido antes de tocar nada", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(swayRunner(calls));

    const result = await controller.focusWindow("no-soy-un-id");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("id numerico");
    expect(calls).toEqual([]);
  });

  test("propaga el error que devuelve Sway cuando la ventana ya no existe", async () => {
    const controller = controllerWith(async () => ok('[{"success":false,"error":"No matching node."}]'));

    const result = await controller.focusWindow(404);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("No matching node.");
  });
});

describe("createDesktopController: teclado", () => {
  test("escribe texto con wtype", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(async (command, args) => {
      calls.push({ command, args });
      return ok();
    });

    const result = await controller.typeText("Hola Pi");

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ command: "wtype", args: ["Hola Pi"] }]);
  });

  test("rechaza texto vacio sin ejecutar nada", async () => {
    const calls: string[] = [];
    const controller = controllerWith(async (command) => {
      calls.push(command);
      return ok();
    });

    const result = await controller.typeText("   ");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("No hay texto que escribir");
    expect(calls).toEqual([]);
  });

  test("manda los guiones iniciales como tecla en vez de como opciones de wtype", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(async (command, args) => {
      calls.push({ command, args });
      return ok();
    });

    await controller.typeText("--flag");

    expect(calls).toEqual([{ command: "wtype", args: ["-k", "minus", "-k", "minus", "flag"] }]);
  });

  test("pulsa atajos con los argumentos traducidos", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(async (command, args) => {
      calls.push({ command, args });
      return ok();
    });

    const result = await controller.pressKeys("ctrl+shift+t");

    expect(result).toMatchObject({ ok: true, combo: "ctrl+shift+t" });
    expect(calls).toEqual([
      { command: "wtype", args: ["-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl"] },
    ]);
  });
});

describe("createDesktopController: raton", () => {
  test("mueve el raton en coordenadas absolutas", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(async (command, args) => {
      calls.push({ command, args });
      return ok();
    });

    await expect(controller.moveMouse(640, 480.4)).resolves.toMatchObject({ ok: true, x: 640, y: 480 });
    expect(calls).toEqual([{ command: "ydotool", args: ["mousemove", "-a", "-x", "640", "-y", "480"] }]);
  });

  test("mueve antes de clicar cuando le dan coordenadas y repite el codigo en el doble clic", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(async (command, args) => {
      calls.push({ command, args });
      return ok();
    });

    await expect(controller.click("left", { x: 100, y: 200, double: true })).resolves.toMatchObject({ ok: true });
    await expect(controller.click("right")).resolves.toMatchObject({ ok: true, button: "right" });

    expect(calls).toEqual([
      { command: "ydotool", args: ["mousemove", "-a", "-x", "100", "-y", "200"] },
      { command: "ydotool", args: ["click", "0xC0", "0xC0"] },
      { command: "ydotool", args: ["click", "0xC1"] },
    ]);
  });

  test("hace scroll con la rueda y avisa de que la direccion depende de la app", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(async (command, args) => {
      calls.push({ command, args });
      return ok();
    });

    const result = await controller.scroll("down", 5);

    expect(result).toMatchObject({ ok: true, direction: "down", amount: 5 });
    expect(result.message).toContain("invierten la rueda");
    expect(calls).toEqual([{ command: "ydotool", args: ["mousemove", "-w", "-x", "0", "-y", "-5"] }]);
  });

  test("explica que hace falta ydotoold cuando ydotool falla", async () => {
    const controller = controllerWith(async () => failure("failed to connect socket /tmp/.ydotool_socket", 1));

    const result = await controller.click("left");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("ydotoold");
    expect(result.message).toContain("/tmp/.ydotool_socket");
  });
});

describe("createDesktopController: capturas", () => {
  test("guarda en ~/Fotos con marca de tiempo y crea la carpeta", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(
      async (command, args) => {
        calls.push({ command, args });
        return ok();
      },
      {
        env: GRAPHICAL_ENV,
        commandExists: () => true,
        homeDir: "/home/usuario",
        now: () => Date.UTC(2026, 7, 18, 9, 30, 15),
      },
    );

    const result = await controller.screenshot();

    expect(result).toMatchObject({
      ok: true,
      path: "/home/usuario/Fotos/agenos-captura-20260818-093015.png",
    });
    expect(calls).toEqual([
      { command: "mkdir", args: ["-p", "/home/usuario/Fotos"] },
      { command: "grim", args: ["/home/usuario/Fotos/agenos-captura-20260818-093015.png"] },
    ]);
  });

  test("expande ~ en la ruta que le pasan", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = controllerWith(
      async (command, args) => {
        calls.push({ command, args });
        return ok();
      },
      { env: GRAPHICAL_ENV, commandExists: () => true, homeDir: "/home/usuario" },
    );

    const result = await controller.screenshot("~/Documentos/pantalla.png");

    expect(result.path).toBe("/home/usuario/Documentos/pantalla.png");
    expect(calls[1]).toEqual({ command: "grim", args: ["/home/usuario/Documentos/pantalla.png"] });
  });
});

describe("createDesktopController: degradacion honesta", () => {
  test("redescubre Sway si el broker arranca antes que la sesion grafica", async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "agenos-session-race-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = createDesktopController({
      env: { XDG_RUNTIME_DIR: runtimeDir },
      commandExists: () => true,
      runCommand: swayRunner(calls),
    });

    const beforeSway = await controller.inspect();
    expect(beforeSway.ok).toBe(false);
    expect(beforeSway.message).toContain("sesion grafica");
    expect(calls).toEqual([]);

    writeFileSync(join(runtimeDir, "wayland-1"), "");
    writeFileSync(join(runtimeDir, "sway-ipc.1000.123.sock"), "");

    const afterSway = await controller.inspect();
    expect(afterSway.ok).toBe(true);
    expect(afterSway.windows.map((window) => window.appId)).toContain("libreoffice-writer");
    expect(calls.map(({ command }) => command)).toEqual(["swaymsg", "swaymsg"]);

    const capabilities = await controller.capabilities();
    expect(capabilities.graphicalSession).toBe(true);
    expect(capabilities.waylandDisplay).toBe("wayland-1");
    expect(capabilities.swaySock).toBe(join(runtimeDir, "sway-ipc.1000.123.sock"));
  });

  test("dice que paquete falta cuando no esta el binario", async () => {
    const calls: string[] = [];
    const controller = createDesktopController({
      env: GRAPHICAL_ENV,
      commandExists: (command) => command === "swaymsg",
      runCommand: async (command) => {
        calls.push(command);
        return ok();
      },
    });

    const typed = await controller.typeText("hola");
    expect(typed.ok).toBe(false);
    expect(typed.message).toContain("'wtype'");
    expect(typed.message).toContain("paquete wtype");

    const moved = await controller.moveMouse(10, 10);
    expect(moved.message).toContain("paquete ydotool");

    const shot = await controller.screenshot("/tmp/x.png");
    expect(shot.message).toContain("paquete grim");

    expect(calls).toEqual([]);
  });

  test("informa del timeout cuando el comando no responde", async () => {
    const controller = controllerWith(async () => TIMED_OUT);

    const result = await controller.inspect();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no respondio en 5000 ms");
  });

  test("no intenta nada si no hay sesion grafica", async () => {
    const calls: string[] = [];
    const controller = createDesktopController({
      env: HEADLESS_ENV,
      commandExists: () => true,
      runCommand: async (command) => {
        calls.push(command);
        return ok();
      },
    });

    for (const result of [
      await controller.inspect(),
      await controller.typeText("hola"),
      await controller.pressKeys("ctrl+s"),
      await controller.moveMouse(1, 1),
      await controller.click("left"),
      await controller.scroll("up"),
      await controller.screenshot("/tmp/x.png"),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.message).toContain("sesion grafica");
    }

    expect(calls).toEqual([]);
  });

  test("capabilities informa de lo que hay y de lo que falta", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = createDesktopController({
      env: GRAPHICAL_ENV,
      commandExists: (command) => command !== "grim",
      runCommand: async (command, args) => {
        calls.push({ command, args });
        // El demonio ydotoold no responde.
        return failure("failed to connect socket", 1);
      },
    });

    const result = await controller.capabilities();

    expect(result.graphicalSession).toBe(true);
    expect(result.commands).toEqual({ swaymsg: true, wtype: true, ydotool: true, grim: false });
    expect(result.ydotoolDaemon).toBe(false);
    expect(result.missing).toEqual(["grim"]);
    expect(result.summary).toContain("ydotoold no responde");
    expect(result.summary).toContain("grim no esta instalado");
    expect(calls).toEqual([{ command: "ydotool", args: ["mousemove", "-x", "0", "-y", "0"] }]);
  });

  test("capabilities no promete nada sin sesion grafica", async () => {
    const controller = createDesktopController({
      env: HEADLESS_ENV,
      commandExists: () => true,
      runCommand: async () => ok(),
    });

    const result = await controller.capabilities();

    expect(result.ok).toBe(false);
    expect(result.graphicalSession).toBe(false);
    expect(result.ydotoolDaemon).toBe(false);
    expect(result.summary).toContain("No hay sesion grafica");
  });
});
