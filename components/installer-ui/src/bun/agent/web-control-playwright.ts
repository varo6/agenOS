import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import type { Browser, Frame, Locator, Page } from "playwright-core";
import {
  buildSnapshotScript,
  createWebController,
  DEFAULT_DEBUG_PORT,
  DEFAULT_SNAPSHOT_MAX_CHARS,
  formatSnapshot,
  MAX_SNAPSHOT_ELEMENTS,
  normalizeWebUrl,
  resolveKeyDefinition,
  type WebActionResult,
  type WebController,
  type WebControllerDeps,
  type WebSnapshot,
  type WebSnapshotElement,
} from "../../../../agent/web-control";

const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
// El endpoint es local. Si no responde en dos segundos, el CDP directo ofrece
// una respuesta mejor que hacer esperar al usuario ocho segundos por acción.
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 120_000;

type PlaywrightModule = typeof import("playwright-core");

export type PlaywrightWebControllerDeps = WebControllerDeps & {
  fallback?: WebController;
  loadPlaywright?: () => Promise<Pick<PlaywrightModule, "chromium">>;
  actionTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Tiempo sin reintentar la conexión tras un fallo. Por defecto 30 s. */
  connectRetryDelayMs?: number;
  /** Permite desactivar Playwright sin quitar el paquete. */
  playwrightEnabled?: boolean;
};

type ParsedRef = {
  frameIndex: number;
  elementRef: string;
};

type FrameSnapshot = {
  ok?: boolean;
  detail?: string;
  url?: string;
  title?: string;
  text?: string;
  textTruncated?: boolean;
  elements?: unknown;
  totalElements?: number;
};

class PlaywrightUnavailableError extends Error {}

function envFlagDisablesPlaywright(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "off", "disabled", "no"].includes(value.trim().toLowerCase());
}

function permanentlyUnavailable(error: unknown): boolean {
  const detail = describeError(error, "");
  return /cannot find|module not found|resolve module|\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i.test(detail);
}

function infrastructureFailure(error: unknown): boolean {
  const detail = describeError(error, "");
  return /target (?:page|context|browser).*closed|browser.*(?:closed|disconnected)|not connected|connection closed|websocket.*closed|protocol error|\bECONN(?:REFUSED|RESET)\b|socket hang up/i.test(detail);
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const text = String(error ?? "").trim();
  return text || fallback;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function expandUserPath(path: string): string {
  const raw = path.trim();
  const home = homedir();
  if (raw === "~") {
    return home;
  }
  if (raw.startsWith("~/")) {
    return join(home, raw.slice(2));
  }
  return isAbsolute(raw) ? raw : join(home, raw);
}

export function parsePlaywrightSnapshotRef(ref: string): ParsedRef | null {
  const match = /^(?:f(\d+):)?(e\d+)$/.exec(ref.trim());
  if (!match) {
    return null;
  }
  return {
    frameIndex: match[1] ? Number(match[1]) : 0,
    elementRef: match[2]!,
  };
}

function normalizeElements(raw: unknown, frameIndex: number): WebSnapshotElement[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const elementRef = String(entry.ref ?? "");
      return {
        ref: frameIndex === 0 ? elementRef : `f${frameIndex}:${elementRef}`,
        tag: String(entry.tag ?? ""),
        role: String(entry.role ?? ""),
        name: String(entry.name ?? ""),
        value: String(entry.value ?? ""),
        placeholder: String(entry.placeholder ?? ""),
      };
    });
}

async function evaluateFrameSnapshot(
  frame: Frame,
  maxChars: number,
  maxElements: number,
): Promise<FrameSnapshot> {
  // El script viaja como expresión y lo evalúa Playwright tal cual. Envolverlo
  // en un `eval` propio añadía una capa que solo servía para perder el error
  // real del script cuando la página lo rechazaba.
  return await frame.evaluate<FrameSnapshot>(buildSnapshotScript(maxChars, maxElements));
}

function pageFrames(page: Page): Frame[] {
  const frames = page.frames();
  const main = page.mainFrame();
  return [main, ...frames.filter((frame) => frame !== main)];
}

async function snapshotPage(page: Page, maxChars: number): Promise<WebSnapshot> {
  const frames = pageFrames(page);
  const elements: WebSnapshotElement[] = [];
  const textParts: string[] = [];
  let title = "";
  let totalElements = 0;
  let textTruncated = false;

  for (let index = 0; index < frames.length; index += 1) {
    const remainingElements = Math.max(1, MAX_SNAPSHOT_ELEMENTS - elements.length);
    const remainingChars = Math.max(200, maxChars - textParts.join("\n").length);
    let raw: FrameSnapshot;
    try {
      raw = await evaluateFrameSnapshot(frames[index]!, remainingChars, remainingElements);
    } catch (error) {
      // Los iframes de anuncios y widgets se reemplazan a menudo mientras se
      // recorre la página. Perder uno de ellos no debe ocultar el documento
      // principal; si falla el marco principal sí se propaga el error real.
      if (index === 0) {
        throw error;
      }
      continue;
    }
    if (!raw || raw.ok !== true) {
      if (index === 0) {
        throw new Error(raw?.detail ?? "el script de lectura no devolvió nada");
      }
      continue;
    }
    if (index === 0) {
      title = String(raw.title ?? "");
    }
    const frameText = String(raw.text ?? "");
    if (frameText) {
      textParts.push(index === 0 ? frameText : `[Marco ${index}: ${String(raw.url ?? "sin URL")}]\n${frameText}`);
    }
    textTruncated ||= raw.textTruncated === true;
    totalElements += typeof raw.totalElements === "number" ? raw.totalElements : 0;
    if (elements.length < MAX_SNAPSHOT_ELEMENTS) {
      elements.push(...normalizeElements(raw.elements, index).slice(0, MAX_SNAPSHOT_ELEMENTS - elements.length));
    }
  }

  let text = textParts.join("\n\n");
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…(texto recortado)`;
    textTruncated = true;
  }

  return {
    url: page.url(),
    title,
    text,
    textTruncated,
    elements,
    totalElements,
  };
}

function locatorForRef(page: Page, ref: string): { locator: Locator; parsed: ParsedRef } | null {
  const parsed = parsePlaywrightSnapshotRef(ref);
  if (!parsed) {
    return null;
  }
  const frame = pageFrames(page)[parsed.frameIndex];
  if (!frame) {
    return null;
  }
  return {
    locator: frame.locator(`[data-agenos-ref="${parsed.elementRef}"]`).first(),
    parsed,
  };
}

async function describeLocator(locator: Locator): Promise<{ target: string; href: string; tag: string }> {
  return await locator.evaluate((node) => {
    const element = node as unknown as {
      tagName: string;
      innerText?: string;
      getAttribute(name: string): string | null;
    };
    const tag = element.tagName.toLowerCase();
    const name = String(
      element.getAttribute("aria-label")
      || element.innerText
      || element.getAttribute("title")
      || element.getAttribute("placeholder")
      || "",
    ).replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      tag,
      target: name ? `${tag} "${name}"` : tag,
      href: element.getAttribute("href") || "",
    };
  });
}

function playwrightKey(key: string, modifiers: string[] | undefined): string {
  const definition = resolveKeyDefinition(key);
  if (!definition) {
    throw new Error(`No sé enviar la tecla "${key}". Usa Enter, Tab, Escape, Backspace, Delete, las flechas o un solo carácter.`);
  }
  const names = new Map([
    ["alt", "Alt"],
    ["ctrl", "Control"],
    ["control", "Control"],
    ["meta", "Meta"],
    ["cmd", "Meta"],
    ["command", "Meta"],
    ["super", "Meta"],
    ["shift", "Shift"],
  ]);
  const parts = (modifiers ?? [])
    .map((modifier) => names.get(modifier.trim().toLowerCase()))
    .filter((modifier): modifier is string => Boolean(modifier));
  return [...new Set(parts), definition.key].join("+");
}

/**
 * Controlador preferente basado en Playwright. Se conecta por CDP al Chromium
 * persistente de AgenOS y conserva el controlador CDP directo como respaldo.
 */
export function createPlaywrightWebController(deps: PlaywrightWebControllerDeps = {}): WebController {
  const port = deps.debugPort ?? DEFAULT_DEBUG_PORT;
  const endpointURL = `http://127.0.0.1:${port}`;
  const actionTimeoutMs = deps.actionTimeoutMs ?? deps.commandTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const fallback = deps.fallback ?? createWebController(deps);
  const loadPlaywright = deps.loadPlaywright ?? (() => import("playwright-core"));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = deps.pollIntervalMs ?? 200;
  const connectRetryDelayMs = deps.connectRetryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS;
  const playwrightEnabled = deps.playwrightEnabled
    ?? !envFlagDisablesPlaywright(process.env.AGENOS_WEB_CONTROL_PLAYWRIGHT);
  let browserPromise: Promise<Browser> | null = null;
  let disabledReason: string | null = playwrightEnabled
    ? null
    : "Playwright está desactivado por AGENOS_WEB_CONTROL_PLAYWRIGHT.";
  let lastPageUrl: string | null = null;
  // Si Chromium no está escuchando, cada acción pagaría el timeout de conexión
  // entera antes de caer al CDP directo. Tras un fallo se deja de reintentar
  // durante un rato para que el respaldo responda al instante.
  let retryConnectAfterMs = 0;
  let lastConnectError = "Playwright no pudo conectarse a Chromium";

  async function browser(): Promise<Browser> {
    if (disabledReason) {
      throw new PlaywrightUnavailableError(disabledReason);
    }
    if (!browserPromise && now() < retryConnectAfterMs) {
      throw new PlaywrightUnavailableError(lastConnectError);
    }
    if (!browserPromise) {
      browserPromise = loadPlaywright()
        .then(({ chromium }) => chromium.connectOverCDP(endpointURL, { timeout: connectTimeoutMs }))
        .then((connected) => {
          connected.on("disconnected", () => {
            browserPromise = null;
          });
          retryConnectAfterMs = 0;
          return connected;
        })
        .catch((error) => {
          browserPromise = null;
          const detail = describeError(error, "Playwright no pudo conectarse a Chromium");
          lastConnectError = detail;
          if (permanentlyUnavailable(error)) {
            disabledReason = detail;
          } else {
            retryConnectAfterMs = now() + connectRetryDelayMs;
          }
          throw new PlaywrightUnavailableError(detail);
        });
    }
    return await browserPromise;
  }

  function pickPage(connected: Browser, urlHint?: string): Page | null {
    const pages = connected.contexts()
      .flatMap((context) => context.pages())
      .filter((page) => !page.url().startsWith("devtools://") && !page.url().startsWith("chrome-extension://"));
    const wanted = urlHint || lastPageUrl;
    if (wanted) {
      const exact = pages.find((page) => page.url() === wanted);
      if (exact) {
        return exact;
      }
    }
    return pages[0] ?? null;
  }

  async function activePage(urlHint?: string): Promise<Page> {
    const connected = await browser();
    const page = pickPage(connected, urlHint);
    if (!page) {
      throw new PlaywrightUnavailableError("Chromium no tiene ninguna pestaña que Playwright pueda manejar.");
    }
    page.setDefaultTimeout(actionTimeoutMs);
    page.setDefaultNavigationTimeout(actionTimeoutMs);
    lastPageUrl = page.url();
    return page;
  }

  async function withFallback<T, U>(playwrightAction: () => Promise<T>, fallbackAction: () => Promise<U>): Promise<T | U> {
    try {
      return await playwrightAction();
    } catch (error) {
      if (error instanceof PlaywrightUnavailableError) {
        return await fallbackAction();
      }
      if (infrastructureFailure(error)) {
        browserPromise = null;
        lastConnectError = describeError(error, "Playwright perdió la conexión con Chromium");
        retryConnectAfterMs = now() + connectRetryDelayMs;
        return await fallbackAction();
      }
      throw error;
    }
  }

  return {
    status: () => fallback.status(),

    async open(input) {
      let normalized: string;
      try {
        normalized = normalizeWebUrl(input);
      } catch (error) {
        return { ok: false, message: describeError(error, "No pude entender la URL.") };
      }

      // Playwright no arranca navegadores: si no hay ninguno escuchando, el
      // respaldo lo lanza con el perfil del usuario y ya deja la pestaña en la
      // URL pedida, así que no se vuelve a navegar por él más abajo.
      let bootstrapped: WebActionResult | null = null;
      const status = await fallback.status();
      if (!status.reachable || !status.targets.some((target) => target.type === "page")) {
        bootstrapped = await fallback.open(normalized);
        if (!bootstrapped.ok) {
          return bootstrapped;
        }
      }

      try {
        return await withFallback(async () => {
          const page = await activePage(normalized);
          if (page.url() !== normalized) {
            await page.goto(normalized, { waitUntil: "domcontentloaded" });
          }
          lastPageUrl = page.url();
          const title = await page.title();
          return {
            ok: true,
            url: page.url() || normalized,
            title,
            message: `Abrí ${page.url() || normalized}${title ? ` (${title})` : ""}.`,
          };
        }, async () => bootstrapped ?? await fallback.open(normalized));
      } catch (error) {
        return { ok: false, message: `No pude abrir ${normalized}: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async snapshot(options) {
      const maxChars = Math.max(200, Math.floor(options?.maxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS));
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const snapshot = await snapshotPage(page, maxChars);
          lastPageUrl = snapshot.url;
          return {
            ok: true,
            url: snapshot.url,
            title: snapshot.title,
            snapshot,
            text: formatSnapshot(snapshot),
            message: `Leí ${snapshot.url || "la página activa"} con ${snapshot.elements.length} elemento(s) interactivo(s).`,
          };
        }, () => fallback.snapshot(options));
      } catch (error) {
        const message = `No pude leer la página: ${describeError(error, "fallo desconocido")}`;
        return { ok: false, message, text: message };
      }
    },

    async click(ref) {
      const cleanRef = String(ref ?? "").trim();
      if (!cleanRef) {
        return { ok: false, message: "Necesito el ref del elemento (por ejemplo e12) que sale en el snapshot." };
      }
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const found = locatorForRef(page, cleanRef);
          if (!found) {
            return {
              ok: false,
              ref: cleanRef,
              message: `No existe ningún elemento con ref "${cleanRef}" en la página actual. Vuelve a pedir un snapshot y usa un ref de la lista nueva.`,
            };
          }
          try {
            const description = await describeLocator(found.locator);
            await found.locator.click();
            return {
              ok: true,
              ref: cleanRef,
              target: description.target,
              message: `Hice clic en ${description.target}${description.href ? ` (enlace a ${truncate(description.href, 120)})` : ""}.`,
            };
          } catch (error) {
            if (await found.locator.count().catch(() => 0) === 0) {
              return {
                ok: false,
                ref: cleanRef,
                message: `No existe ningún elemento con ref "${cleanRef}" en la página actual. Vuelve a pedir un snapshot y usa un ref de la lista nueva.`,
              };
            }
            throw error;
          }
        }, () => fallback.click(cleanRef));
      } catch (error) {
        return { ok: false, ref: cleanRef, message: `No pude hacer clic en "${cleanRef}": ${describeError(error, "fallo desconocido")}` };
      }
    },

    async type(ref, text, options) {
      const cleanRef = String(ref ?? "").trim();
      if (!cleanRef) {
        return { ok: false, message: "Necesito el ref del campo (por ejemplo e7) que sale en el snapshot." };
      }
      const value = String(text ?? "");
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const found = locatorForRef(page, cleanRef);
          if (!found) {
            return {
              ok: false,
              ref: cleanRef,
              message: `No existe ningún elemento con ref "${cleanRef}" en la página actual. Pide un snapshot nuevo y usa un ref de la lista nueva.`,
            };
          }
          try {
            const description = await describeLocator(found.locator);
            if (description.tag === "select") {
              // Consultar primero las opciones evita pagar dos timeouts enteros
              // de selectOption cuando el texto pedido no existe.
              const selectedValue = await found.locator.evaluate((node, requested) => {
                const select = node as unknown as {
                  options: ArrayLike<{ value: string; textContent: string | null }>;
                };
                const clean = (text: string | null) => String(text ?? "").replace(/\s+/g, " ").trim();
                const wanted = clean(requested);
                const options = Array.from(select.options);
                const exact = options.find((option) => option.value === requested || clean(option.textContent) === wanted);
                const partial = exact ?? options.find((option) => clean(option.textContent).toLowerCase().includes(wanted.toLowerCase()));
                return partial?.value ?? null;
              }, value);
              if (selectedValue === null) {
                return {
                  ok: false,
                  ref: cleanRef,
                  message: `El desplegable "${cleanRef}" no tiene ninguna opción que coincida con "${truncate(value, 60)}".`,
                };
              }
              await found.locator.selectOption({ value: selectedValue });
            } else if (options?.clear === false) {
              await found.locator.focus();
              await found.locator.press("End");
              await found.locator.pressSequentially(value);
            } else {
              await found.locator.fill(value);
            }
            let submitNote = "";
            if (options?.submit === true) {
              await found.locator.press("Enter");
              submitNote = " y pulsé Enter";
            }
            return {
              ok: true,
              ref: cleanRef,
              target: description.target,
              message: `Escribí "${truncate(value, 120)}" en ${description.target}${submitNote}.`,
            };
          } catch (error) {
            if (await found.locator.count().catch(() => 0) === 0) {
              return {
                ok: false,
                ref: cleanRef,
                message: `No existe ningún elemento con ref "${cleanRef}" en la página actual. Pide un snapshot nuevo y usa un ref de la lista nueva.`,
              };
            }
            throw error;
          }
        }, () => fallback.type(cleanRef, value, options));
      } catch (error) {
        return { ok: false, ref: cleanRef, message: `No pude escribir en "${cleanRef}": ${describeError(error, "fallo desconocido")}` };
      }
    },

    async pressKey(key, modifiers) {
      const cleanKey = String(key ?? "").trim();
      if (!cleanKey) {
        return { ok: false, message: "Necesito el nombre de la tecla (Enter, Tab, Escape, ArrowDown, a…)." };
      }
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const combo = playwrightKey(cleanKey, modifiers);
          await page.keyboard.press(combo);
          return { ok: true, message: `Pulsé ${combo}.` };
        }, () => fallback.pressKey(cleanKey, modifiers));
      } catch (error) {
        return { ok: false, message: `No pude pulsar "${cleanKey}": ${describeError(error, "fallo desconocido")}` };
      }
    },

    async waitFor(options) {
      const wantedText = options.text?.trim() || undefined;
      const wantedRef = options.ref?.trim() || undefined;
      if (!wantedText && !wantedRef) {
        return { ok: false, message: "Dime qué esperar: un texto que deba aparecer o un ref que deba existir." };
      }
      const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? Math.min(options.timeoutMs, MAX_WAIT_TIMEOUT_MS)
        : DEFAULT_ACTION_TIMEOUT_MS;
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const started = now();
          for (;;) {
            const frames = pageFrames(page);
            const textFound = !wantedText || (await Promise.all(
              frames.map((frame) => frame.getByText(wantedText, { exact: false }).first().isVisible().catch(() => false)),
            )).some(Boolean);
            const refFound = !wantedRef || await (async () => {
              const found = locatorForRef(page, wantedRef);
              return Boolean(found && await found.locator.isVisible().catch(() => false));
            })();
            const elapsedMs = now() - started;
            if (textFound && refFound) {
              return {
                ok: true,
                url: page.url(),
                title: await page.title().catch(() => ""),
                elapsedMs,
                message: `Apareció ${wantedText ? `el texto "${truncate(wantedText, 80)}"` : `el elemento "${wantedRef}"`} tras ${elapsedMs} ms.`,
              };
            }
            if (elapsedMs >= timeoutMs) {
              return {
                ok: false,
                elapsedMs,
                message: `Esperé ${elapsedMs} ms y ${wantedText ? `el texto "${truncate(wantedText, 80)}"` : `el elemento "${wantedRef}"`} no apareció. La página puede seguir cargando o pedir que inicies sesión.`,
              };
            }
            await sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
          }
        }, () => fallback.waitFor(options));
      } catch (error) {
        return { ok: false, message: `No pude esperar en la página: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async extract(selector, options) {
      const cleanSelector = String(selector ?? "").trim();
      if (!cleanSelector) {
        return { ok: false, matches: [], message: "Necesito un selector CSS, por ejemplo h3 o .zA .bog." };
      }
      const limit = typeof options?.limit === "number" && options.limit > 0
        ? Math.min(Math.floor(options.limit), 500)
        : 50;
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const matches: string[] = [];
          let total = 0;
          for (const frame of pageFrames(page)) {
            const locator = frame.locator(cleanSelector);
            const count = await locator.count();
            total += count;
            for (let index = 0; index < count && matches.length < limit; index += 1) {
              const item = locator.nth(index);
              const value = options?.attribute
                ? await item.getAttribute(options.attribute)
                : await item.innerText().catch(() => item.textContent());
              if (value) {
                matches.push(value.replace(/\s+/g, " ").trim());
              }
            }
          }
          return {
            ok: true,
            matches,
            message: matches.length > 0
              ? `Encontré ${matches.length} resultado(s) para "${cleanSelector}" (de ${total} nodos).`
              : `El selector "${cleanSelector}" no encontró nada con texto en la página actual.`,
          };
        }, () => fallback.extract(cleanSelector, options));
      } catch (error) {
        return { ok: false, matches: [], message: `No pude extraer con "${cleanSelector}": ${describeError(error, "fallo desconocido")}` };
      }
    },

    async screenshot(path) {
      const rawPath = String(path ?? "").trim();
      if (!rawPath) {
        return { ok: false, message: "Necesito la ruta donde guardar la captura, por ejemplo ~/Imagenes/captura.png." };
      }
      const target = expandUserPath(rawPath);
      try {
        return await withFallback(async () => {
          const page = await activePage();
          await mkdir(dirname(target), { recursive: true });
          await page.screenshot({ path: target, fullPage: false });
          return { ok: true, path: target, message: `Guardé la captura de la página en ${target}.` };
        }, () => fallback.screenshot(rawPath));
      } catch (error) {
        return { ok: false, path: target, message: `No pude guardar la captura en ${target}: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async back() {
      try {
        return await withFallback(async () => {
          const page = await activePage();
          const previousUrl = page.url();
          const response = await page.goBack({ waitUntil: "domcontentloaded" });
          // Playwright devuelve null para navegaciones sin respuesta de red,
          // incluidas las entradas de historial same-document y data:. La URL
          // distingue ese caso de un historial realmente vacío.
          if (!response && page.url() === previousUrl) {
            return { ok: false, message: "No hay ninguna página anterior en el historial de esta pestaña." };
          }
          lastPageUrl = page.url();
          return { ok: true, url: page.url(), title: await page.title(), message: `Volví atrás a ${page.url()}.` };
        }, () => fallback.back());
      } catch (error) {
        return { ok: false, message: `No pude volver atrás: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async reload() {
      try {
        return await withFallback(async () => {
          const page = await activePage();
          await page.reload({ waitUntil: "domcontentloaded" });
          lastPageUrl = page.url();
          return { ok: true, url: page.url(), title: await page.title(), message: `Recargué ${page.url()}.` };
        }, () => fallback.reload());
      } catch (error) {
        return { ok: false, message: `No pude recargar la página: ${describeError(error, "fallo desconocido")}` };
      }
    },
  } satisfies WebController;
}
