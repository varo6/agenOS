import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClickScript,
  buildSnapshotScript,
  buildTypeScript,
  createWebController,
  DEFAULT_DEBUG_PORT,
  formatSnapshot,
  modifiersToBitmask,
  normalizeWebUrl,
  resolveKeyDefinition,
  type CdpSocket,
  type CdpTargetInfo,
  type WebControllerDeps,
  type WebSnapshot,
} from "./web-control";

// --------------------------------------------------------------------------------------
// Objetivos CDP de mentira
// --------------------------------------------------------------------------------------

const PAGE_TARGET: CdpTargetInfo = {
  id: "TARGET-1",
  type: "page",
  title: "Ejemplo",
  url: "https://example.com/",
  webSocketDebuggerUrl: "ws://127.0.0.1:18800/devtools/page/TARGET-1",
};

const MAIL_TARGET: CdpTargetInfo = {
  id: "TARGET-2",
  type: "page",
  title: "Correo",
  url: "https://mail.example.com/",
  webSocketDebuggerUrl: "ws://127.0.0.1:18800/devtools/page/TARGET-2",
};

const DEVTOOLS_TARGET: CdpTargetInfo = {
  id: "TARGET-D",
  type: "page",
  title: "DevTools",
  url: "devtools://devtools/bundled/inspector.html",
  webSocketDebuggerUrl: "ws://127.0.0.1:18800/devtools/page/TARGET-D",
};

const EXTENSION_TARGET: CdpTargetInfo = {
  id: "TARGET-E",
  type: "page",
  title: "Extensión",
  url: "chrome-extension://abcdef/popup.html",
  webSocketDebuggerUrl: "ws://127.0.0.1:18800/devtools/page/TARGET-E",
};

const WORKER_TARGET = {
  id: "TARGET-W",
  type: "service_worker",
  title: "sw",
  url: "https://example.com/sw.js",
  webSocketDebuggerUrl: "ws://127.0.0.1:18800/devtools/worker/TARGET-W",
};

// --------------------------------------------------------------------------------------
// Doble de Chromium: /json/list por fetch y CDP por un socket falso.
// --------------------------------------------------------------------------------------

type SentCommand = { id: number; method: string; params: Record<string, unknown> };
type CdpReply = Record<string, unknown> | null;

const DEFAULT_INFO = { ok: true, url: "https://example.com/", title: "Ejemplo", readyState: "complete" };

const DEFAULT_SNAPSHOT_VALUE = {
  ok: true,
  url: "https://example.com/",
  title: "Ejemplo",
  text: "Bienvenido a Ejemplo",
  textTruncated: false,
  elements: [{ ref: "e1", tag: "button", role: "button", name: "Entrar", value: "", placeholder: "" }],
  totalElements: 1,
};

type ScriptValue = unknown | (() => unknown);

type HarnessOptions = {
  targets?: () => unknown[];
  listFailures?: number;
  scripts?: Record<string, ScriptValue>;
  commands?: Record<string, CdpReply>;
  /** Permite inyectar ruido en el canal antes o despues de la respuesta buena. */
  frames?: (id: number, reply: string) => string[];
  deps?: Partial<WebControllerDeps>;
};

function createHarness(options: HarnessOptions = {}) {
  const state = {
    sent: [] as SentCommand[],
    fetched: [] as string[],
    socketUrls: [] as string[],
    socketsOpened: 0,
    socketsClosed: 0,
    ensureCalls: [] as Array<string | undefined>,
    clock: 0,
  };

  const targets = options.targets ?? (() => [PAGE_TARGET]);
  let listFailuresLeft = options.listFailures ?? 0;

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    state.fetched.push(url);
    if (url.includes("/json/list")) {
      if (listFailuresLeft > 0) {
        listFailuresLeft -= 1;
        throw new Error("connect ECONNREFUSED 127.0.0.1");
      }
      const payload = targets();
      if (!Array.isArray(payload)) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    if (url.includes("/json/new")) {
      expect(String(init?.method)).toBe("PUT");
      return new Response(JSON.stringify({ id: "TARGET-NUEVO" }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;

  const scripts: Record<string, ScriptValue> = {
    info: DEFAULT_INFO,
    snapshot: DEFAULT_SNAPSHOT_VALUE,
    click: { ok: true, target: 'a "Entrar"', href: "" },
    type: { ok: true, target: 'campo "Buscar"', mode: "input" },
    wait: { ok: true, textFound: false, refFound: false, readyState: "complete" },
    extract: { ok: true, matches: [], total: 0 },
    ...options.scripts,
  };

  function handle(method: string, params: Record<string, unknown>): CdpReply {
    if (options.commands && method in options.commands) {
      return options.commands[method] ?? null;
    }
    if (method !== "Runtime.evaluate") {
      return {};
    }
    const expression = String(params.expression ?? "");
    const kind = /^\/\*agenos:([a-z]+)\*\//.exec(expression)?.[1] ?? "";
    const entry = scripts[kind];
    const value = typeof entry === "function" ? (entry as () => unknown)() : entry;
    if (value === undefined) {
      return {};
    }
    return { result: { value } };
  }

  const connectWebSocket = async (url: string): Promise<CdpSocket> => {
    state.socketsOpened += 1;
    state.socketUrls.push(url);
    let listener: ((data: string) => void) | null = null;
    return {
      send(payload: string) {
        const message = JSON.parse(payload) as { id: number; method: string; params: Record<string, unknown> };
        state.sent.push({ id: message.id, method: message.method, params: message.params });
        const reply = handle(message.method, message.params);
        if (reply === null) {
          return; // Chromium no contesta: obliga al timeout del comando.
        }
        const frame = JSON.stringify({ id: message.id, ...reply });
        for (const chunk of options.frames ? options.frames(message.id, frame) : [frame]) {
          listener?.(chunk);
        }
      },
      onMessage(cb: (data: string) => void) {
        listener = cb;
      },
      close() {
        state.socketsClosed += 1;
      },
    };
  };

  const controller = createWebController({
    fetchImpl,
    connectWebSocket,
    now: () => state.clock,
    sleep: async (ms: number) => {
      state.clock += ms;
    },
    ensureBrowser: undefined,
    ...options.deps,
  });

  return { controller, state };
}

function evaluations(sent: SentCommand[]): string[] {
  return sent.filter((entry) => entry.method === "Runtime.evaluate").map((entry) => String(entry.params.expression));
}

function keyEvents(sent: SentCommand[]): Array<Record<string, unknown>> {
  return sent.filter((entry) => entry.method === "Input.dispatchKeyEvent").map((entry) => entry.params);
}

// --------------------------------------------------------------------------------------
// Funciones puras
// --------------------------------------------------------------------------------------

describe("normalizeWebUrl", () => {
  test("añade https cuando falta el esquema", () => {
    expect(normalizeWebUrl("example.com")).toBe("https://example.com/");
    expect(normalizeWebUrl("  www.ejemplo.es/ruta?q=uno  ")).toBe("https://www.ejemplo.es/ruta?q=uno");
    expect(normalizeWebUrl("HTTPS://Example.COM/Ruta")).toBe("https://example.com/Ruta");
  });

  test("respeta http y los puertos locales", () => {
    expect(normalizeWebUrl("http://127.0.0.1:8080/panel")).toBe("http://127.0.0.1:8080/panel");
  });

  test("rechaza la cadena vacia", () => {
    expect(() => normalizeWebUrl("   ")).toThrow("La URL es obligatoria.");
    expect(() => normalizeWebUrl("")).toThrow("La URL es obligatoria.");
  });

  test("rechaza los esquemas que no son http ni https", () => {
    expect(() => normalizeWebUrl("file:///etc/passwd")).toThrow("Solo puedo manejar páginas http o https.");
    expect(() => normalizeWebUrl("javascript:alert(1)")).toThrow("Solo puedo manejar páginas http o https.");
    expect(() => normalizeWebUrl("chrome://settings")).toThrow("Solo puedo manejar páginas http o https.");
  });

  test("rechaza lo que no se puede parsear como URL", () => {
    expect(() => normalizeWebUrl("https://")).toThrow('"https://" no es una URL válida.');
  });
});

describe("resolveKeyDefinition", () => {
  test("reconoce las teclas con nombre", () => {
    expect(resolveKeyDefinition("Enter")).toEqual({ key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
    expect(resolveKeyDefinition("  return  ")).toEqual({ key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
    expect(resolveKeyDefinition("ESC")).toEqual({ key: "Escape", code: "Escape", keyCode: 27 });
    expect(resolveKeyDefinition("ArrowDown")).toEqual({ key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    expect(resolveKeyDefinition("down")).toEqual({ key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
    expect(resolveKeyDefinition("space")).toEqual({ key: " ", code: "Space", keyCode: 32, text: " " });
  });

  test("construye la definicion de un solo caracter", () => {
    expect(resolveKeyDefinition("a")).toEqual({ key: "a", code: "KeyA", keyCode: 65, text: "a" });
    expect(resolveKeyDefinition("Z")).toEqual({ key: "Z", code: "KeyZ", keyCode: 90, text: "Z" });
    expect(resolveKeyDefinition("7")).toEqual({ key: "7", code: "Digit7", keyCode: 55, text: "7" });
    expect(resolveKeyDefinition("ñ")).toEqual({ key: "ñ", code: "", keyCode: 209, text: "ñ" });
  });

  test("devuelve null cuando no sabe mandar la tecla", () => {
    expect(resolveKeyDefinition("")).toBeNull();
    expect(resolveKeyDefinition("   ")).toBeNull();
    expect(resolveKeyDefinition("Ctrl+Shift+P")).toBeNull();
    expect(resolveKeyDefinition("F13")).toBeNull();
  });
});

describe("modifiersToBitmask", () => {
  test("suma los bits de cada modificador conocido", () => {
    expect(modifiersToBitmask(["alt"])).toBe(1);
    expect(modifiersToBitmask(["ctrl"])).toBe(2);
    expect(modifiersToBitmask(["Control"])).toBe(2);
    expect(modifiersToBitmask(["meta"])).toBe(4);
    expect(modifiersToBitmask([" Cmd "])).toBe(4);
    expect(modifiersToBitmask(["super"])).toBe(4);
    expect(modifiersToBitmask(["shift"])).toBe(8);
    expect(modifiersToBitmask(["ctrl", "shift"])).toBe(10);
    expect(modifiersToBitmask(["ctrl", "control"])).toBe(2);
  });

  test("ignora lo desconocido y las listas vacias", () => {
    expect(modifiersToBitmask(undefined)).toBe(0);
    expect(modifiersToBitmask([])).toBe(0);
    expect(modifiersToBitmask(["hyper"])).toBe(0);
    expect(modifiersToBitmask(["hyper", "alt"])).toBe(1);
  });
});

describe("formatSnapshot", () => {
  test("lista los elementos con ref, rol, nombre, valor y placeholder", () => {
    const snapshot: WebSnapshot = {
      url: "https://example.com/buscar",
      title: "Buscador",
      text: "Bienvenido a Ejemplo\nBusca lo que quieras",
      textTruncated: false,
      elements: [
        { ref: "e1", tag: "input", role: "searchbox", name: "Buscar", value: "gatitos", placeholder: "¿Qué buscas?" },
        { ref: "e2", tag: "button", role: "button", name: "Enviar", value: "", placeholder: "" },
        { ref: "e3", tag: "div", role: "generic", name: "", value: "", placeholder: "" },
      ],
      totalElements: 7,
    };

    expect(formatSnapshot(snapshot)).toBe(
      [
        "URL: https://example.com/buscar",
        "Título: Buscador",
        "",
        "TEXTO VISIBLE:",
        "Bienvenido a Ejemplo",
        "Busca lo que quieras",
        "",
        "ELEMENTOS INTERACTIVOS (3 de 7):",
        '[e1] input/searchbox "Buscar" valor="gatitos" placeholder="¿Qué buscas?"',
        '[e2] button/button "Enviar"',
        "[e3] div",
      ].join("\n"),
    );
  });

  test("explica una pagina vacia en lugar de dejar huecos", () => {
    expect(
      formatSnapshot({ url: "", title: "", text: "", textTruncated: false, elements: [], totalElements: 0 }),
    ).toBe(
      [
        "URL: ",
        "Título: (sin título)",
        "",
        "TEXTO VISIBLE:",
        "(la página no tiene texto visible)",
        "",
        "ELEMENTOS INTERACTIVOS (0 de 0):",
        "(no encontré elementos interactivos visibles)",
      ].join("\n"),
    );
  });
});

describe("scripts inyectados", () => {
  test("buildSnapshotScript acota los limites que le pasan", () => {
    const script = buildSnapshotScript(10, 0);
    expect(script).toContain("var MAXC = 200;");
    expect(script).toContain("var MAXE = 1;");
    expect(buildSnapshotScript(6000, 120)).toContain("var MAXC = 6000;");
    expect(script.startsWith("/*agenos:snapshot*/")).toBe(true);
  });

  test("buildClickScript y buildTypeScript escapan lo que viene del modelo", () => {
    const click = buildClickScript('e1"] , script[src');
    expect(click).toContain(JSON.stringify(JSON.stringify('e1"] , script[src')));

    expect(buildTypeScript("e7", 'hola "mundo"', true)).toContain('var VALUE = "hola \\"mundo\\"";');
    expect(buildTypeScript("e7", "x", true)).toContain("var CLEAR = true;");
    expect(buildTypeScript("e7", "x", false)).toContain("var CLEAR = false;");
  });
});

// --------------------------------------------------------------------------------------
// Descubrimiento de pestañas
// --------------------------------------------------------------------------------------

describe("status", () => {
  test("descubre las pestañas por /json/list y descarta devtools y extensiones", async () => {
    const { controller, state } = createHarness({
      targets: () => [PAGE_TARGET, MAIL_TARGET, DEVTOOLS_TARGET, EXTENSION_TARGET, WORKER_TARGET],
    });

    const result = await controller.status();

    expect(state.fetched).toEqual(["http://127.0.0.1:18800/json/list"]);
    expect(result.ok).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.targets).toHaveLength(5);
    expect(result.message).toBe(
      "Chromium responde en el puerto 18800 con 2 pestaña(s): https://example.com/, https://mail.example.com/.",
    );
  });

  test("normaliza las entradas raras que devuelve Chromium", async () => {
    const { controller } = createHarness({
      targets: () => [null, "basura", { id: 7 }, { type: "page", url: "https://sinid.example/" }],
    });

    const result = await controller.status();

    expect(result.targets).toEqual([
      { id: "7", type: "", title: "", url: "", webSocketDebuggerUrl: undefined },
      { id: "", type: "page", title: "", url: "https://sinid.example/", webSocketDebuggerUrl: undefined },
    ]);
  });

  test("avisa cuando responde pero no hay ninguna pestaña normal", async () => {
    const { controller } = createHarness({ targets: () => [DEVTOOLS_TARGET, WORKER_TARGET] });

    const result = await controller.status();

    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      "Chromium responde en el puerto 18800 pero no tiene ninguna pestaña normal abierta.",
    );
  });

  test("con el puerto cerrado explica como arrancar Chromium", async () => {
    const { controller } = createHarness({ listFailures: Number.MAX_SAFE_INTEGER });

    const result = await controller.status();

    expect(result).toMatchObject({ ok: false, reachable: false, targets: [] });
    expect(result.message).toContain(
      "Chromium no responde en el puerto 18800 del protocolo DevTools. Hay que arrancarlo con --remote-debugging-port=18800.",
    );
    expect(result.message).toContain("connect ECONNREFUSED");
  });

  test("usa el puerto que le inyecten", async () => {
    const { controller, state } = createHarness({ deps: { debugPort: 9333 } });

    const result = await controller.status();

    expect(state.fetched[0]).toBe("http://127.0.0.1:9333/json/list");
    expect(result.message).toContain("puerto 9333");
    expect(DEFAULT_DEBUG_PORT).toBe(18800);
  });

  test("se queja si /json/list no devuelve una lista", async () => {
    const { controller } = createHarness({ targets: () => ({ error: "nope" }) as unknown as unknown[] });

    const result = await controller.status();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Chromium devolvió una lista de pestañas con un formato que no entiendo.");
  });
});

// --------------------------------------------------------------------------------------
// Protocolo CDP: correlacion y timeouts
// --------------------------------------------------------------------------------------

describe("canal CDP", () => {
  test("correlaciona las respuestas por id y descarta eventos, basura y duplicados", async () => {
    const { controller, state } = createHarness({
      frames: (id, reply) => [
        "esto no es json",
        JSON.stringify({ method: "Page.frameNavigated", params: { frame: {} } }),
        JSON.stringify({ id: id + 500, result: { value: { ok: true, text: "respuesta de otro comando" } } }),
        JSON.stringify({ id: String(id), result: { value: { ok: false } } }),
        reply,
        JSON.stringify({ id, result: { value: { ok: false, detail: "duplicado tardio" } } }),
      ],
    });

    const result = await controller.snapshot();

    expect(result.ok).toBe(true);
    expect(result.snapshot?.elements).toEqual([
      { ref: "e1", tag: "button", role: "button", name: "Entrar", value: "", placeholder: "" },
    ]);
    expect(result.message).toBe("Leí https://example.com/ con 1 elemento(s) interactivo(s).");
    expect(state.socketsOpened).toBe(1);
    expect(state.socketsClosed).toBe(1);
  });

  test("un comando sin respuesta caduca con el timeout inyectado", async () => {
    const { controller, state } = createHarness({
      commands: { "Runtime.evaluate": null },
      deps: { commandTimeoutMs: 5 },
    });

    const result = await controller.snapshot();

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "No pude leer la página: El comando Runtime.evaluate de DevTools no respondió en 5 ms.",
    );
    expect(result.text).toBe(result.message);
    expect(state.socketsClosed).toBe(1);
  });

  test("un error del protocolo se traduce al castellano", async () => {
    const { controller } = createHarness({
      commands: { "Runtime.evaluate": { error: { message: "Cannot find context with specified id" } } },
    });

    const result = await controller.snapshot();

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "No pude leer la página: Chromium rechazó el comando DevTools: Cannot find context with specified id",
    );
  });

  test("una excepcion de la pagina se cuenta como rechazo del script", async () => {
    const { controller } = createHarness({
      commands: {
        "Runtime.evaluate": {
          result: { exceptionDetails: {} },
          exceptionDetails: { exception: { description: "TypeError: x is not a function" } },
        },
      },
    });

    const result = await controller.snapshot();

    expect(result.message).toContain("La página rechazó el script del agente: TypeError: x is not a function");
  });

  test("sin pestañas normales no se abre ningun socket", async () => {
    const { controller, state } = createHarness({ targets: () => [WORKER_TARGET, DEVTOOLS_TARGET] });

    const result = await controller.snapshot();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no tiene ninguna pestaña normal abierta");
    expect(state.socketsOpened).toBe(0);
  });

  test("una pestaña sin canal DevTools se explica", async () => {
    const { controller } = createHarness({
      targets: () => [{ id: "T", type: "page", title: "x", url: "https://example.com/" }],
    });

    const result = await controller.snapshot();

    expect(result.message).toContain("no expone canal DevTools");
  });

  test("recuerda la ultima pestaña usada para las acciones siguientes", async () => {
    const { controller, state } = createHarness({ targets: () => [PAGE_TARGET, MAIL_TARGET] });

    await controller.open("https://mail.example.com/");
    await controller.snapshot();

    expect(state.socketUrls).toEqual([MAIL_TARGET.webSocketDebuggerUrl, MAIL_TARGET.webSocketDebuggerUrl]);
  });
});

// --------------------------------------------------------------------------------------
// open
// --------------------------------------------------------------------------------------

describe("open", () => {
  test("navega cuando la pestaña esta en otra URL", async () => {
    const infos = [
      { ok: true, url: "https://example.com/", title: "Ejemplo", readyState: "complete" },
      { ok: true, url: "https://otra.example/", title: "Otra", readyState: "complete" },
    ];
    let call = 0;
    const { controller, state } = createHarness({
      scripts: { info: () => infos[Math.min(call++, infos.length - 1)] },
    });

    const result = await controller.open("otra.example");

    expect(state.sent.some((entry) => entry.method === "Page.navigate")).toBe(true);
    expect(state.sent.find((entry) => entry.method === "Page.navigate")?.params).toEqual({
      url: "https://otra.example/",
    });
    expect(result).toMatchObject({
      ok: true,
      url: "https://otra.example/",
      title: "Otra",
      message: "Abrí https://otra.example/ (Otra).",
    });
  });

  test("no navega si la pestaña ya esta en esa URL", async () => {
    const { controller, state } = createHarness();

    const result = await controller.open("https://example.com/");

    expect(state.sent.some((entry) => entry.method === "Page.navigate")).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Abrí https://example.com/ (Ejemplo).");
  });

  test("rechaza las URLs imposibles sin tocar Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.open("file:///etc/passwd")).toEqual({
      ok: false,
      message: "Solo puedo manejar páginas http o https.",
    });
    expect(state.fetched).toEqual([]);
  });

  test("con el puerto cerrado y sin ensureBrowser dice como arrancar Chromium", async () => {
    const { controller, state } = createHarness({ listFailures: Number.MAX_SAFE_INTEGER });

    const result = await controller.open("example.com");

    expect(result).toEqual({
      ok: false,
      message:
        "Chromium no responde en el puerto 18800 del protocolo DevTools. Hay que arrancarlo con --remote-debugging-port=18800.",
    });
    expect(state.socketsOpened).toBe(0);
  });

  test("con el puerto cerrado arranca Chromium por ensureBrowser y espera al puerto", async () => {
    const ensureCalls: Array<string | undefined> = [];
    const { controller, state } = createHarness({
      listFailures: 2,
      deps: {
        ensureBrowser: async (url) => {
          ensureCalls.push(url);
          return { ok: true, message: "Chromium arrancado." };
        },
      },
    });

    const result = await controller.open("example.com");

    expect(ensureCalls).toEqual(["https://example.com/"]);
    expect(state.clock).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });

  test("si ensureBrowser falla lo cuenta tal cual", async () => {
    const { controller } = createHarness({
      listFailures: Number.MAX_SAFE_INTEGER,
      deps: { ensureBrowser: async () => ({ ok: false, message: "no encontré chromium" }) },
    });

    expect(await controller.open("example.com")).toEqual({
      ok: false,
      message: "No pude arrancar Chromium para manejar la web: no encontré chromium",
    });
  });

  test("si Chromium arranca pero el puerto sigue mudo se rinde con el timeout de arranque", async () => {
    const { controller, state } = createHarness({
      listFailures: Number.MAX_SAFE_INTEGER,
      deps: {
        ensureBrowser: async () => ({ ok: true, message: "arrancado" }),
        browserBootTimeoutMs: 1_000,
        pollIntervalMs: 250,
      },
    });

    const result = await controller.open("example.com");

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Chromium arrancó pero el puerto 18800 de DevTools sigue sin responder. Comprueba que se lanzó con --remote-debugging-port=18800.",
    );
    expect(state.clock).toBe(1_000);
  });

  test("si no hay ninguna pestaña abre una nueva con /json/new", async () => {
    const abiertas: unknown[] = [];
    const { controller, state } = createHarness({
      targets: () => [...abiertas],
      scripts: { info: { ok: true, url: "https://example.com/", title: "Ejemplo", readyState: "complete" } },
    });
    // La primera consulta no ve pestañas; tras /json/new aparece una.
    const original = state.fetched;
    const { controller: _unused } = { controller };
    void _unused;
    void original;

    const promise = (async () => {
      const result = await controller.open("https://example.com/");
      return result;
    })();
    // /json/new es lo que hace aparecer la pestaña.
    queueMicrotask(() => abiertas.push(PAGE_TARGET));
    const result = await promise;

    expect(state.fetched.some((url) => url.includes("/json/new?https%3A%2F%2Fexample.com%2F"))).toBe(true);
    expect(result.ok).toBe(true);
  });
});

// --------------------------------------------------------------------------------------
// snapshot
// --------------------------------------------------------------------------------------

describe("snapshot", () => {
  test("devuelve el texto formateado y normaliza los elementos raros", async () => {
    const { controller, state } = createHarness({
      scripts: {
        snapshot: {
          ok: true,
          url: "https://example.com/buscar",
          title: "Buscador",
          text: "Hola",
          textTruncated: true,
          elements: [null, "basura", { ref: "e1" }, { ref: "e2", tag: "a", role: "link", name: "Ir" }],
        },
      },
      deps: { commandTimeoutMs: 1_000 },
    });

    const result = await controller.snapshot({ maxChars: 1200 });

    expect(evaluations(state.sent)[0]).toContain("var MAXC = 1200;");
    expect(result.snapshot).toEqual({
      url: "https://example.com/buscar",
      title: "Buscador",
      text: "Hola",
      textTruncated: true,
      elements: [
        { ref: "e1", tag: "", role: "", name: "", value: "", placeholder: "" },
        { ref: "e2", tag: "a", role: "link", name: "Ir", value: "", placeholder: "" },
      ],
      totalElements: 2,
    });
    expect(result.text).toContain("[e2] a/link \"Ir\"");
  });

  test("si el script falla lo dice sin lanzar excepciones", async () => {
    const { controller } = createHarness({
      scripts: { snapshot: { ok: false, reason: "script", detail: "document is not defined" } },
    });

    const result = await controller.snapshot();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("document is not defined");
    expect(result.text).toBe(result.message);
  });
});

// --------------------------------------------------------------------------------------
// click
// --------------------------------------------------------------------------------------

describe("click", () => {
  test("hace clic y describe el elemento y el enlace", async () => {
    const { controller, state } = createHarness({
      scripts: { click: { ok: true, target: 'a "Entrar"', href: "https://example.com/login" } },
    });

    const result = await controller.click("  e12  ");

    expect(evaluations(state.sent)[0]).toContain('"e12"');
    expect(result).toMatchObject({
      ok: true,
      ref: "e12",
      target: 'a "Entrar"',
      message: 'Hice clic en a "Entrar" (enlace a https://example.com/login).',
    });
  });

  test("un ref que ya no existe pide un snapshot nuevo", async () => {
    const { controller, state } = createHarness({ scripts: { click: { ok: false, reason: "sin-ref" } } });

    const result = await controller.click("e99");

    expect(result).toEqual({
      ok: false,
      ref: "e99",
      message:
        'No existe ningún elemento con ref "e99" en la página actual. Vuelve a pedir un snapshot y usa un ref de la lista nueva.',
    });
    expect(state.socketsClosed).toBe(1);
  });

  test("un fallo del script de clic se explica con el detalle", async () => {
    const { controller } = createHarness({
      scripts: { click: { ok: false, reason: "script", detail: "el nodo se quitó del DOM" } },
    });

    expect((await controller.click("e1")).message).toBe(
      'No pude hacer clic en "e1": el nodo se quitó del DOM.',
    );
  });

  test("sin ref no llega a hablar con Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.click("   ")).toEqual({
      ok: false,
      message: "Necesito el ref del elemento (por ejemplo e12) que sale en el snapshot.",
    });
    expect(state.fetched).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// type
// --------------------------------------------------------------------------------------

describe("type", () => {
  test("escribe y con submit pulsa Enter", async () => {
    const { controller, state } = createHarness();

    const result = await controller.type("e7", "gatitos", { submit: true });

    expect(evaluations(state.sent)[0]).toContain('var VALUE = "gatitos";');
    expect(evaluations(state.sent)[0]).toContain("var CLEAR = true;");
    expect(keyEvents(state.sent)).toEqual([
      {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        modifiers: 0,
        text: "\r",
        unmodifiedText: "\r",
      },
      {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        modifiers: 0,
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      ref: "e7",
      message: 'Escribí "gatitos" en campo "Buscar" y pulsé Enter.',
    });
  });

  test("sin submit no manda ninguna tecla y respeta clear:false", async () => {
    const { controller, state } = createHarness();

    const result = await controller.type("e7", "más texto", { clear: false });

    expect(keyEvents(state.sent)).toEqual([]);
    expect(evaluations(state.sent)[0]).toContain("var CLEAR = false;");
    expect(result.message).toBe('Escribí "más texto" en campo "Buscar".');
  });

  test("un elemento que no acepta texto se explica", async () => {
    const { controller } = createHarness({
      scripts: { type: { ok: false, reason: "no-escribible", target: 'div "Cabecera"' } },
    });

    expect((await controller.type("e3", "hola")).message).toBe(
      'El elemento "e3" (div "Cabecera") no acepta texto. Haz clic en él primero o busca el campo de escritura real.',
    );
  });

  test("un desplegable sin la opcion pedida se explica", async () => {
    const { controller } = createHarness({ scripts: { type: { ok: false, reason: "sin-opcion" } } });

    expect((await controller.type("e4", "Marte")).message).toBe(
      'El desplegable "e4" no tiene ninguna opción que coincida con "Marte".',
    );
  });

  test("un ref inexistente pide un snapshot nuevo", async () => {
    const { controller } = createHarness({ scripts: { type: { ok: false, reason: "sin-ref" } } });

    expect((await controller.type("e9", "x")).message).toContain(
      'No existe ningún elemento con ref "e9" en la página actual.',
    );
  });

  test("sin ref no habla con Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.type("", "hola")).toEqual({
      ok: false,
      message: "Necesito el ref del campo (por ejemplo e7) que sale en el snapshot.",
    });
    expect(state.fetched).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// pressKey
// --------------------------------------------------------------------------------------

describe("pressKey", () => {
  test("con ctrl+shift manda rawKeyDown sin texto y la mascara correcta", async () => {
    const { controller, state } = createHarness();

    const result = await controller.pressKey("a", ["ctrl", "shift"]);

    expect(keyEvents(state.sent)).toEqual([
      {
        type: "rawKeyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        modifiers: 10,
      },
      {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        modifiers: 10,
      },
    ]);
    expect(result).toEqual({ ok: true, message: "Pulsé ctrl+shift+a." });
  });

  test("un caracter suelto manda rawKeyDown, char y keyUp", async () => {
    const { controller, state } = createHarness();

    const result = await controller.pressKey("ñ");

    expect(keyEvents(state.sent).map((event) => event.type)).toEqual(["rawKeyDown", "char", "keyUp"]);
    expect(keyEvents(state.sent)[1]).toEqual({
      type: "char",
      key: "ñ",
      text: "ñ",
      unmodifiedText: "ñ",
      modifiers: 0,
    });
    expect(result.message).toBe("Pulsé ñ.");
  });

  test("una tecla que no sabe mandar se explica", async () => {
    const { controller } = createHarness();

    expect((await controller.pressKey("Ctrl+P")).message).toBe(
      'No pude pulsar "Ctrl+P": No sé enviar la tecla "Ctrl+P". Usa Enter, Tab, Escape, Backspace, Delete, las flechas o un solo carácter.',
    );
  });

  test("sin tecla no habla con Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.pressKey("  ")).toEqual({
      ok: false,
      message: "Necesito el nombre de la tecla (Enter, Tab, Escape, ArrowDown, a…).",
    });
    expect(state.fetched).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// waitFor
// --------------------------------------------------------------------------------------

describe("waitFor", () => {
  test("expira cuando el texto no llega nunca", async () => {
    const { controller, state } = createHarness({
      scripts: { wait: { ok: true, textFound: false, refFound: null, readyState: "complete" } },
      deps: { pollIntervalMs: 250 },
    });

    const result = await controller.waitFor({ text: "Bandeja de entrada", timeoutMs: 1_000 });

    expect(result).toEqual({
      ok: false,
      elapsedMs: 1_000,
      message:
        'Esperé 1000 ms y el texto "Bandeja de entrada" no apareció. La página puede seguir cargando o pedir que inicies sesión.',
    });
    expect(state.clock).toBe(1_000);
    expect(state.socketsClosed).toBe(1);
  });

  test("vuelve en cuanto aparece el texto", async () => {
    let intentos = 0;
    const { controller } = createHarness({
      scripts: {
        wait: () => ({ ok: true, textFound: ++intentos >= 3, refFound: null, readyState: "complete" }),
      },
      deps: { pollIntervalMs: 250 },
    });

    const result = await controller.waitFor({ text: "  Listo  ", timeoutMs: 5_000 });

    expect(result).toMatchObject({
      ok: true,
      url: "https://example.com/",
      title: "Ejemplo",
      elapsedMs: 500,
      message: 'Apareció el texto "Listo" tras 500 ms.',
    });
  });

  test("tambien sabe esperar a un ref", async () => {
    const { controller, state } = createHarness({
      scripts: { wait: { ok: true, textFound: null, refFound: true, readyState: "complete" } },
    });

    const result = await controller.waitFor({ ref: "e5" });

    expect(evaluations(state.sent)[0]).toContain('var REF = "e5";');
    expect(result.message).toBe('Apareció el elemento "e5" tras 0 ms.');
  });

  test("un ref que no aparece expira con el timeout por defecto acotado", async () => {
    const { controller } = createHarness({
      scripts: { wait: { ok: true, textFound: null, refFound: false, readyState: "complete" } },
      deps: { pollIntervalMs: 5_000 },
    });

    const result = await controller.waitFor({ ref: "e5", timeoutMs: 999_999 });

    expect(result.ok).toBe(false);
    expect(result.elapsedMs).toBe(120_000);
    expect(result.message).toContain('el elemento "e5" no apareció');
  });

  test("un script que revienta cuenta como no encontrado y acaba expirando", async () => {
    const { controller } = createHarness({
      commands: { "Runtime.evaluate": { error: { message: "Execution context was destroyed" } } },
      deps: { pollIntervalMs: 500 },
    });

    const result = await controller.waitFor({ text: "hola", timeoutMs: 1_000 });

    expect(result.ok).toBe(false);
    expect(result.elapsedMs).toBe(1_000);
  });

  test("sin criterio no habla con Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.waitFor({ text: "   ", ref: "  " })).toEqual({
      ok: false,
      message: "Dime qué esperar: un texto que deba aparecer o un ref que deba existir.",
    });
    expect(state.fetched).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// extract
// --------------------------------------------------------------------------------------

describe("extract", () => {
  test("devuelve las coincidencias y acota el limite", async () => {
    const { controller, state } = createHarness({
      scripts: { extract: { ok: true, matches: ["Uno", "Dos"], total: 9 } },
    });

    const result = await controller.extract("  h3.titulo  ", { attribute: "  href  ", limit: 900 });

    expect(evaluations(state.sent)[0]).toContain('var SELECTOR = "h3.titulo";');
    expect(evaluations(state.sent)[0]).toContain('var ATTRIBUTE = "href";');
    expect(evaluations(state.sent)[0]).toContain("var LIMIT = 500;");
    expect(result).toEqual({
      ok: true,
      matches: ["Uno", "Dos"],
      message: 'Encontré 2 resultado(s) para "h3.titulo" (de 9 nodos).',
    });
  });

  test("sin coincidencias lo dice en claro", async () => {
    const { controller } = createHarness({ scripts: { extract: { ok: true, matches: [], total: 0 } } });

    expect((await controller.extract(".nada")).message).toBe(
      'El selector ".nada" no encontró nada con texto en la página actual.',
    );
  });

  test("un selector invalido se explica", async () => {
    const { controller } = createHarness({
      scripts: { extract: { ok: false, reason: "selector", detail: "no es un selector válido" } },
    });

    expect(await controller.extract("h3[")).toEqual({
      ok: false,
      matches: [],
      message: 'El selector "h3[" no es válido: no es un selector válido.',
    });
  });

  test("sin selector no habla con Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.extract("  ")).toEqual({
      ok: false,
      matches: [],
      message: "Necesito un selector CSS, por ejemplo h3 o .zA .bog.",
    });
    expect(state.fetched).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// back / reload / screenshot
// --------------------------------------------------------------------------------------

describe("navegacion", () => {
  test("back vuelve a la entrada anterior del historial", async () => {
    const { controller, state } = createHarness({
      commands: {
        "Page.getNavigationHistory": {
          result: {
            currentIndex: 2,
            entries: [
              { id: 10, url: "https://example.com/uno" },
              { id: 11, url: "https://example.com/dos" },
              { id: 12, url: "https://example.com/tres" },
            ],
          },
        },
      },
    });

    const result = await controller.back();

    expect(state.sent.find((entry) => entry.method === "Page.navigateToHistoryEntry")?.params).toEqual({
      entryId: 11,
    });
    expect(result).toMatchObject({ ok: true, message: "Volví atrás a https://example.com/." });
  });

  test("back avisa cuando no hay historial", async () => {
    const { controller, state } = createHarness({
      commands: { "Page.getNavigationHistory": { result: { currentIndex: 0, entries: [{ id: 10 }] } } },
    });

    expect(await controller.back()).toEqual({
      ok: false,
      message: "No hay ninguna página anterior en el historial de esta pestaña.",
    });
    expect(state.sent.some((entry) => entry.method === "Page.navigateToHistoryEntry")).toBe(false);
  });

  test("reload recarga y devuelve la URL final", async () => {
    const { controller, state } = createHarness();

    const result = await controller.reload();

    expect(state.sent.find((entry) => entry.method === "Page.reload")?.params).toEqual({ ignoreCache: false });
    expect(result).toMatchObject({ ok: true, url: "https://example.com/", message: "Recargué https://example.com/." });
  });

  test("screenshot guarda el png que devuelve Chromium", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenos-web-control-"));
    const destino = join(dir, "capturas", "pagina.png");
    const png = Buffer.from("un png de mentira", "utf8").toString("base64");
    const { controller } = createHarness({
      commands: { "Page.captureScreenshot": { result: { data: png } } },
    });

    try {
      const result = await controller.screenshot(destino);

      expect(result).toEqual({ ok: true, path: destino, message: `Guardé la captura de la página en ${destino}.` });
      expect(await readFile(destino, "utf8")).toBe("un png de mentira");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("screenshot avisa si Chromium no devuelve imagen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenos-web-control-"));
    const destino = join(dir, "pagina.png");
    const { controller } = createHarness({ commands: { "Page.captureScreenshot": { result: {} } } });

    try {
      expect(await controller.screenshot(destino)).toEqual({
        ok: false,
        path: destino,
        message: "Chromium no devolvió ninguna imagen para la captura.",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("screenshot sin ruta no habla con Chromium", async () => {
    const { controller, state } = createHarness();

    expect(await controller.screenshot("  ")).toEqual({
      ok: false,
      message: "Necesito la ruta donde guardar la captura, por ejemplo ~/Imagenes/captura.png.",
    });
    expect(state.fetched).toEqual([]);
  });
});
