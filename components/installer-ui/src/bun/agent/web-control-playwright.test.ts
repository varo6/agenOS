import { describe, expect, test } from "bun:test";

import type { WebController, WebSnapshotResult } from "../../../../agent/web-control";
import { createPlaywrightWebController, parsePlaywrightSnapshotRef } from "./web-control-playwright";

function fallbackController(overrides: Partial<WebController> = {}): WebController {
  return {
    status: async () => ({ ok: true, reachable: true, targets: [], message: "CDP listo" }),
    open: async (url) => ({ ok: true, url, message: `fallback open ${url}` }),
    snapshot: async () => ({ ok: true, message: "fallback snapshot", text: "fallback" }),
    click: async (ref) => ({ ok: true, ref, message: `fallback click ${ref}` }),
    type: async (ref) => ({ ok: true, ref, message: `fallback type ${ref}` }),
    pressKey: async (key) => ({ ok: true, message: `fallback key ${key}` }),
    waitFor: async () => ({ ok: true, message: "fallback wait" }),
    extract: async () => ({ ok: true, matches: [], message: "fallback extract" }),
    screenshot: async (path) => ({ ok: true, path, message: "fallback screenshot" }),
    back: async () => ({ ok: true, message: "fallback back" }),
    reload: async () => ({ ok: true, message: "fallback reload" }),
    ...overrides,
  };
}

type FakeLocator = {
  first(): FakeLocator;
  count(): Promise<number>;
  evaluate(): Promise<{ tag: string; target: string; href: string }>;
  click(): Promise<void>;
  isVisible(): Promise<boolean>;
};

function locator(onClick?: () => void): FakeLocator {
  const value: FakeLocator = {
    first: () => value,
    count: async () => 1,
    evaluate: async () => ({ tag: "button", target: 'button "Entrar"', href: "" }),
    click: async () => onClick?.(),
    isVisible: async () => true,
  };
  return value;
}

function playwrightHarness(input: {
  mainSnapshot?: Record<string, unknown>;
  childSnapshot?: Record<string, unknown>;
  childSnapshotError?: Error;
  childLocatorCount?: number;
  onChildClick?: () => void;
  pageUrl?: () => string;
  goBack?: () => Promise<unknown>;
}) {
  const calls = { endpoints: [] as string[], childSelectors: [] as string[], scripts: [] as unknown[] };
  const mainLocator = locator();
  const childLocator = locator(input.onChildClick);
  childLocator.count = async () => input.childLocatorCount ?? 1;
  const mainFrame: Record<string, unknown> = {
    evaluate: async (script: unknown) => {
      calls.scripts.push(script);
      return input.mainSnapshot ?? {
        ok: true,
        url: "https://example.com/",
        title: "Ejemplo",
        text: "Página principal",
        elements: [{ ref: "e1", tag: "button", role: "button", name: "Principal", value: "", placeholder: "" }],
        totalElements: 1,
      };
    },
    locator: () => mainLocator,
    getByText: () => mainLocator,
  };
  const childFrame: Record<string, unknown> = {
    evaluate: async (script: unknown) => {
      calls.scripts.push(script);
      if (input.childSnapshotError) {
        throw input.childSnapshotError;
      }
      return input.childSnapshot ?? {
        ok: true,
        url: "https://frame.example/",
        title: "",
        text: "Contenido del marco",
        elements: [{ ref: "e1", tag: "button", role: "button", name: "Entrar", value: "", placeholder: "" }],
        totalElements: 1,
      };
    },
    locator: (selector: string) => {
      calls.childSelectors.push(selector);
      return childLocator;
    },
    getByText: () => childLocator,
  };
  const page: Record<string, unknown> = {
    url: input.pageUrl ?? (() => "https://example.com/"),
    title: async () => "Ejemplo",
    frames: () => [mainFrame, childFrame],
    mainFrame: () => mainFrame,
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {},
    keyboard: { press: async () => {} },
    goBack: input.goBack,
  };
  const browser = {
    contexts: () => [{ pages: () => [page] }],
    on: () => {},
  };
  const loadPlaywright = async () => ({
    chromium: {
      connectOverCDP: async (endpoint: string) => {
        calls.endpoints.push(endpoint);
        return browser;
      },
    },
  });
  return { calls, loadPlaywright };
}

describe("Playwright web controller", () => {
  test("interpreta refs de la página principal y de marcos", () => {
    expect(parsePlaywrightSnapshotRef("e12")).toEqual({ frameIndex: 0, elementRef: "e12" });
    expect(parsePlaywrightSnapshotRef("f2:e7")).toEqual({ frameIndex: 2, elementRef: "e7" });
    expect(parsePlaywrightSnapshotRef("iframe:e7")).toBeNull();
  });

  test("se conecta al Chromium existente y conserva refs inequívocos entre marcos", async () => {
    const harness = playwrightHarness({});
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: harness.loadPlaywright as never,
    });

    const result = await controller.snapshot();

    expect(harness.calls.endpoints).toEqual(["http://127.0.0.1:18800"]);
    expect(result.ok).toBe(true);
    expect(result.snapshot?.elements.map((element) => element.ref)).toEqual(["e1", "f1:e1"]);
    expect(result.snapshot?.text).toContain("[Marco 1: https://frame.example/]");
  });

  test("usa Locator.click y resuelve el marco codificado en el snapshot", async () => {
    let clicked = 0;
    const harness = playwrightHarness({ onChildClick: () => clicked += 1 });
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: harness.loadPlaywright as never,
    });

    const result = await controller.click("f1:e1");

    expect(result).toMatchObject({ ok: true, ref: "f1:e1", target: 'button "Entrar"' });
    expect(clicked).toBe(1);
    expect(harness.calls.childSelectors).toEqual(['[data-agenos-ref="e1"]']);
  });

  test("deja que Locator.click espere aunque el elemento no exista en la consulta inmediata", async () => {
    let clicked = 0;
    const harness = playwrightHarness({
      childLocatorCount: 0,
      onChildClick: () => clicked += 1,
    });
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: harness.loadPlaywright as never,
    });

    expect(await controller.click("f1:e1")).toMatchObject({ ok: true, ref: "f1:e1" });
    expect(clicked).toBe(1);
  });

  test("un iframe que se desprende no invalida el snapshot principal", async () => {
    const harness = playwrightHarness({ childSnapshotError: new Error("Frame was detached") });
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: harness.loadPlaywright as never,
    });

    const result = await controller.snapshot();

    expect(result.ok).toBe(true);
    expect(result.snapshot?.elements.map((element) => element.ref)).toEqual(["e1"]);
    expect(result.snapshot?.text).toBe("Página principal");
  });

  test("reconoce un back sin respuesta HTTP cuando la URL sí cambia", async () => {
    let url = "https://example.com/#segunda";
    const harness = playwrightHarness({
      pageUrl: () => url,
      goBack: async () => {
        url = "https://example.com/#primera";
        return null;
      },
    });
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: harness.loadPlaywright as never,
    });

    expect(await controller.back()).toMatchObject({
      ok: true,
      url: "https://example.com/#primera",
    });
  });

  test("vuelve al CDP directo cuando playwright-core no se puede cargar", async () => {
    let fallbackCalls = 0;
    const fallback = fallbackController({
      snapshot: async (): Promise<WebSnapshotResult> => {
        fallbackCalls += 1;
        return { ok: true, message: "snapshot CDP", text: "desde CDP" };
      },
    });
    const controller = createPlaywrightWebController({
      fallback,
      loadPlaywright: async () => {
        throw new Error("Cannot find module playwright-core");
      },
    });

    expect(await controller.snapshot()).toEqual({ ok: true, message: "snapshot CDP", text: "desde CDP" });
    expect(await controller.snapshot()).toEqual({ ok: true, message: "snapshot CDP", text: "desde CDP" });
    expect(fallbackCalls).toBe(2);
  });

  test("permite desactivar Playwright sin intentar cargar el módulo", async () => {
    let loads = 0;
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      playwrightEnabled: false,
      loadPlaywright: async () => {
        loads += 1;
        throw new Error("no debería cargarse");
      },
    });

    expect((await controller.snapshot()).text).toBe("fallback");
    expect(loads).toBe(0);
  });

  test("un error de permisos desactiva Playwright para el resto del proceso", async () => {
    let loads = 0;
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: async () => {
        loads += 1;
        throw new Error("EACCES: permission denied, open playwright-core");
      },
    });

    expect((await controller.snapshot()).text).toBe("fallback");
    expect((await controller.snapshot()).text).toBe("fallback");
    expect(loads).toBe(1);
  });

  test("un cierre del transporte cae al CDP y activa el enfriamiento", async () => {
    let attempts = 0;
    let fallbackCalls = 0;
    const fallback = fallbackController({
      snapshot: async () => {
        fallbackCalls += 1;
        return { ok: true, message: "snapshot CDP", text: "fallback estable" };
      },
    });
    const mainFrame = {
      evaluate: async () => {
        throw new Error("Target page, context or browser has been closed");
      },
    };
    const page = {
      url: () => "https://example.com/",
      frames: () => [mainFrame],
      mainFrame: () => mainFrame,
      setDefaultTimeout: () => {},
      setDefaultNavigationTimeout: () => {},
    };
    const controller = createPlaywrightWebController({
      fallback,
      loadPlaywright: async () => ({
        chromium: {
          connectOverCDP: async () => {
            attempts += 1;
            return {
              contexts: () => [{ pages: () => [page] }],
              on: () => {},
            };
          },
        },
      }) as never,
    });

    expect((await controller.snapshot()).text).toBe("fallback estable");
    expect((await controller.snapshot()).text).toBe("fallback estable");
    expect(attempts).toBe(1);
    expect(fallbackCalls).toBe(2);
  });

  test("sin Chromium escuchando arranca por el respaldo y no navega dos veces", async () => {
    const opened: string[] = [];
    const fallback = fallbackController({
      status: async () => ({ ok: false, reachable: false, targets: [], message: "puerto cerrado" }),
      open: async (url) => {
        opened.push(url);
        return { ok: true, url, message: `fallback open ${url}` };
      },
    });
    const controller = createPlaywrightWebController({
      fallback,
      loadPlaywright: async () => {
        throw new Error("Cannot find module playwright-core");
      },
    });

    const result = await controller.open("https://example.test/inicio");

    expect(result).toMatchObject({ ok: true, url: "https://example.test/inicio" });
    expect(opened).toEqual(["https://example.test/inicio"]);
  });

  test("pasa el script de lectura tal cual, sin envolverlo en otro eval", async () => {
    const harness = playwrightHarness({});
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      loadPlaywright: harness.loadPlaywright as never,
    });

    await controller.snapshot();

    expect(harness.calls.scripts).toHaveLength(2);
    for (const script of harness.calls.scripts) {
      expect(typeof script).toBe("string");
      expect(String(script).startsWith("/*agenos:snapshot*/")).toBe(true);
      expect(String(script)).not.toContain("eval(");
    }
  });

  test("tras un fallo de conexión no reintenta hasta pasar el enfriamiento", async () => {
    let attempts = 0;
    let clock = 1_000;
    const controller = createPlaywrightWebController({
      fallback: fallbackController(),
      connectRetryDelayMs: 30_000,
      now: () => clock,
      loadPlaywright: async () => ({
        chromium: {
          connectOverCDP: async () => {
            attempts += 1;
            throw new Error("connect ECONNREFUSED 127.0.0.1:18800");
          },
        },
      }) as never,
    });

    expect((await controller.snapshot()).text).toBe("fallback");
    expect((await controller.snapshot()).text).toBe("fallback");
    expect(attempts).toBe(1);

    clock += 30_001;
    expect((await controller.snapshot()).text).toBe("fallback");
    expect(attempts).toBe(2);
  });
});
