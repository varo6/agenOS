import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Control de la web real del usuario mediante Chrome DevTools Protocol.
 *
 * Este módulo NO lanza Chromium: se conecta a un Chromium que ya está corriendo con
 * `--remote-debugging-port=<puerto>`. Si el puerto no responde y hay un callback
 * `ensureBrowser` inyectado, se pide el arranque a través de él.
 *
 * Reglas del módulo:
 * - Ningún método público lanza excepciones: todos devuelven `{ ok, message }` en español.
 * - No se hace ninguna llamada a red ni a procesos al importar el módulo.
 * - Todo WebSocket que se abre se cierra.
 */

export const DEFAULT_DEBUG_PORT = 18800;
export const DEFAULT_SNAPSHOT_MAX_CHARS = 6000;
export const MAX_SNAPSHOT_ELEMENTS = 120;

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 400;
const DEFAULT_BROWSER_BOOT_TIMEOUT_MS = 20_000;
const DEFAULT_READY_TIMEOUT_MS = 12_000;
const DEFAULT_EXTRACT_LIMIT = 50;
const CONNECT_TIMEOUT_MS = 8_000;

/** Interfaz mínima de socket que necesita el cliente CDP (inyectable en tests). */
export type CdpSocket = {
  send(payload: string): void;
  onMessage(cb: (data: string) => void): void;
  close(): void;
  /** Espera a que el canal esté abierto. Opcional: el conector por defecto ya resuelve abierto. */
  ready?(): Promise<void>;
};

export type CdpTargetInfo = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export type WebControllerDeps = {
  debugPort?: number;
  fetchImpl?: typeof fetch;
  connectWebSocket?: (url: string) => Promise<CdpSocket>;
  ensureBrowser?: (url?: string) => Promise<{ ok: boolean; message: string }>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Timeout por comando CDP. Por defecto 15 s. */
  commandTimeoutMs?: number;
  /** Timeout de las peticiones HTTP a /json/*. Por defecto 5 s. */
  requestTimeoutMs?: number;
  /** Intervalo de sondeo de waitFor y de espera de arranque. Por defecto 400 ms. */
  pollIntervalMs?: number;
  /** Tiempo máximo esperando a que el puerto responda tras ensureBrowser. Por defecto 20 s. */
  browserBootTimeoutMs?: number;
  /** Tiempo máximo esperando a que el documento esté listo. Por defecto 12 s. */
  readyTimeoutMs?: number;
};

export type WebSnapshotElement = {
  ref: string;
  tag: string;
  role: string;
  name: string;
  value: string;
  placeholder: string;
};

export type WebSnapshot = {
  url: string;
  title: string;
  text: string;
  textTruncated: boolean;
  elements: WebSnapshotElement[];
  totalElements: number;
};

export type WebStatusResult = {
  ok: boolean;
  reachable: boolean;
  targets: CdpTargetInfo[];
  message: string;
};

export type WebActionResult = {
  ok: boolean;
  message: string;
  url?: string;
  title?: string;
  ref?: string;
  target?: string;
  path?: string;
  elapsedMs?: number;
};

export type WebSnapshotResult = WebActionResult & {
  snapshot?: WebSnapshot;
  text: string;
};

export type WebExtractResult = WebActionResult & {
  matches: string[];
};

export type SnapshotOptions = { maxChars?: number };
export type TypeOptions = { submit?: boolean; clear?: boolean };
export type WaitForOptions = { text?: string; ref?: string; timeoutMs?: number };
export type ExtractOptions = { attribute?: string; limit?: number };

export type WebController = {
  status(): Promise<WebStatusResult>;
  open(url: string): Promise<WebActionResult>;
  snapshot(options?: SnapshotOptions): Promise<WebSnapshotResult>;
  click(ref: string): Promise<WebActionResult>;
  type(ref: string, text: string, options?: TypeOptions): Promise<WebActionResult>;
  pressKey(key: string, modifiers?: string[]): Promise<WebActionResult>;
  waitFor(options: WaitForOptions): Promise<WebActionResult>;
  extract(selector: string, options?: ExtractOptions): Promise<WebExtractResult>;
  screenshot(path: string): Promise<WebActionResult>;
  back(): Promise<WebActionResult>;
  reload(): Promise<WebActionResult>;
};

type CdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
};

type PendingCommand = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type KeyDefinition = {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
};

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  super: 4,
  shift: 8,
};

const NAMED_KEYS: Record<string, KeyDefinition> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9, text: "\t" },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

export function resolveKeyDefinition(key: string): KeyDefinition | null {
  const raw = key.trim();
  if (!raw) {
    return null;
  }

  const named = NAMED_KEYS[raw.toLowerCase()];
  if (named) {
    return named;
  }

  if (raw.length === 1) {
    const upper = raw.toUpperCase();
    const codePoint = upper.codePointAt(0) ?? 0;
    const isLetter = codePoint >= 65 && codePoint <= 90;
    const isDigit = codePoint >= 48 && codePoint <= 57;
    return {
      key: raw,
      code: isLetter ? `Key${upper}` : isDigit ? `Digit${upper}` : "",
      keyCode: codePoint,
      text: raw,
    };
  }

  return null;
}

export function modifiersToBitmask(modifiers: string[] | undefined): number {
  if (!modifiers?.length) {
    return 0;
  }
  let mask = 0;
  for (const modifier of modifiers) {
    const bit = MODIFIER_BITS[String(modifier).trim().toLowerCase()];
    if (bit) {
      mask |= bit;
    }
  }
  return mask;
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const text = String(error ?? "").trim();
  return text || fallback;
}

export function normalizeWebUrl(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("La URL es obligatoria.");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${raw}" no es una URL válida.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo puedo manejar páginas http o https.");
  }
  return url.toString();
}

function expandUserPath(path: string, home: string): string {
  const raw = path.trim();
  if (raw === "~") {
    return home;
  }
  if (raw.startsWith("~/")) {
    return join(home, raw.slice(2));
  }
  return isAbsolute(raw) ? raw : join(home, raw);
}

function truncateForModel(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function formatSnapshot(snapshot: WebSnapshot): string {
  const lines: string[] = [
    `URL: ${snapshot.url}`,
    `Título: ${snapshot.title || "(sin título)"}`,
    "",
    "TEXTO VISIBLE:",
    snapshot.text || "(la página no tiene texto visible)",
    "",
    `ELEMENTOS INTERACTIVOS (${snapshot.elements.length} de ${snapshot.totalElements}):`,
  ];
  if (snapshot.elements.length === 0) {
    lines.push("(no encontré elementos interactivos visibles)");
  }
  for (const element of snapshot.elements) {
    const head = element.role && element.role !== "generic"
      ? `${element.tag}/${element.role}`
      : element.tag;
    const bits = [`[${element.ref}]`, head];
    if (element.name) {
      bits.push(JSON.stringify(element.name));
    }
    if (element.value) {
      bits.push(`valor=${JSON.stringify(element.value)}`);
    }
    if (element.placeholder) {
      bits.push(`placeholder=${JSON.stringify(element.placeholder)}`);
    }
    lines.push(bits.join(" "));
  }
  return lines.join("\n");
}

// --------------------------------------------------------------------------------------
// Scripts inyectados en la página. Se escriben sin plantillas anidadas y con los
// backslashes duplicados para que el JavaScript emitido sea válido.
// --------------------------------------------------------------------------------------

const SCRIPT_HELPERS = `
    var NL = String.fromCharCode(10);
    function styleOf(el){ try { return window.getComputedStyle(el); } catch (e) { return null; } }
    function isHidden(el, st){
      if (el.hasAttribute && el.hasAttribute("hidden")) return true;
      if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
      if (!st) return false;
      if (st.display === "none") return true;
      if (st.visibility === "hidden" || st.visibility === "collapse") return true;
      return false;
    }
    function isVisible(el){
      var st = styleOf(el);
      if (isHidden(el, st)) return false;
      if (st && st.opacity === "0") return false;
      var r = null;
      try { r = el.getBoundingClientRect(); } catch (e) { return false; }
      if (!r) return false;
      if (r.width <= 0 && r.height <= 0) return false;
      return true;
    }
    function clean(value){ return String(value == null ? "" : value).replace(/\\s+/g, " ").trim(); }
    function cut(value, max){ var v = clean(value); return v.length > max ? v.slice(0, max) + "…" : v; }
    function accessibleName(el){
      var aria = clean(el.getAttribute && el.getAttribute("aria-label"));
      if (aria) return aria;
      var labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
      if (labelledBy) {
        var ids = labelledBy.split(/\\s+/);
        var acc = [];
        for (var i = 0; i < ids.length; i++) {
          var ref = document.getElementById(ids[i]);
          if (ref) acc.push(clean(ref.innerText || ref.textContent));
        }
        var joined = clean(acc.join(" "));
        if (joined) return joined;
      }
      if (el.labels && el.labels.length) {
        var lab = clean(el.labels[0].innerText || el.labels[0].textContent);
        if (lab) return lab;
      }
      var own = clean(el.innerText || el.textContent);
      if (own) return own;
      var attrs = ["alt", "title", "placeholder", "aria-placeholder", "name", "value"];
      for (var j = 0; j < attrs.length; j++) {
        var v = clean(el.getAttribute && el.getAttribute(attrs[j]));
        if (v) return v;
      }
      return "";
    }
    function describe(el){
      if (!el) return "elemento";
      var tag = String(el.tagName || "").toLowerCase();
      var name = cut(accessibleName(el), 80);
      return name ? tag + " \\"" + name + "\\"" : tag;
    }
`;

export function buildSnapshotScript(maxChars: number, maxElements: number): string {
  return `/*agenos:snapshot*/(function(){
  try {
    var MAXC = ${Math.max(200, Math.floor(maxChars))};
    var MAXE = ${Math.max(1, Math.floor(maxElements))};
${SCRIPT_HELPERS}
    var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,TEMPLATE:1,HEAD:1,SVG:1,CANVAS:1,IFRAME:1,OBJECT:1,VIDEO:1,AUDIO:1};
    var BLOCK = {P:1,DIV:1,LI:1,TR:1,BR:1,HR:1,SECTION:1,ARTICLE:1,HEADER:1,FOOTER:1,NAV:1,MAIN:1,ASIDE:1,UL:1,OL:1,TABLE:1,FORM:1,BLOCKQUOTE:1,PRE:1,TD:1,TH:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,LABEL:1,OPTION:1,BUTTON:1,DL:1,DD:1,DT:1,FIGURE:1,ADDRESS:1};
    var parts = [];
    var used = 0;
    var budget = MAXC * 4;
    function walk(node){
      if (used > budget) return;
      if (node.nodeType === 3) {
        var t = String(node.nodeValue == null ? "" : node.nodeValue).replace(/\\s+/g, " ");
        if (t.trim()) { parts.push(t); used += t.length; }
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = String(node.tagName || "").toUpperCase();
      if (SKIP[tag]) return;
      var st = styleOf(node);
      if (isHidden(node, st)) return;
      var display = st ? String(st.display || "") : "";
      var block = BLOCK[tag] === 1
        || display === "block" || display === "flex" || display === "grid"
        || display === "list-item" || display.indexOf("table") === 0;
      if (block) parts.push(NL);
      if (tag === "INPUT" || tag === "TEXTAREA") {
        var itype = String((node.getAttribute("type") || "")).toLowerCase();
        var ival = itype === "password" ? "" : String(node.value || node.getAttribute("placeholder") || "");
        if (ival) { parts.push("[" + (itype || tag.toLowerCase()) + ": " + clean(ival) + "]"); used += ival.length; }
      }
      if (tag === "SELECT") {
        var sval = clean(node.value);
        if (sval) { parts.push("[select: " + sval + "]"); used += sval.length; }
      }
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      if (block) parts.push(NL);
    }
    if (document.body) walk(document.body);
    var text = parts.join(" ")
      .replace(/[ \\t]+/g, " ")
      .replace(/ ?\\n ?/g, NL)
      .replace(/\\n{3,}/g, NL + NL)
      .trim();
    var textTruncated = text.length > MAXC;
    if (textTruncated) text = text.slice(0, MAXC) + NL + "…(texto recortado)";

    var maxSeen = 0;
    var marked = document.querySelectorAll("[data-agenos-ref]");
    for (var m = 0; m < marked.length; m++) {
      var got = /^e(\\d+)$/.exec(marked[m].getAttribute("data-agenos-ref") || "");
      if (got) { var n = parseInt(got[1], 10); if (n > maxSeen) maxSeen = n; }
    }
    var counter = maxSeen;

    function roleOf(el, tag){
      var explicit = clean(el.getAttribute && el.getAttribute("role"));
      if (explicit) return explicit;
      if (tag === "a") return el.getAttribute("href") ? "link" : "generic";
      if (tag === "button") return "button";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "input") {
        var t = String(el.getAttribute("type") || "text").toLowerCase();
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "submit" || t === "button" || t === "reset" || t === "image") return "button";
        if (t === "search") return "searchbox";
        return "textbox";
      }
      if (el.getAttribute && el.getAttribute("contenteditable") === "true") return "textbox";
      return "generic";
    }

    var selector = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable="true"]';
    var candidates = document.querySelectorAll(selector);
    var elements = [];
    var total = 0;
    for (var c = 0; c < candidates.length; c++) {
      var el = candidates[c];
      if (!isVisible(el)) continue;
      total += 1;
      if (elements.length >= MAXE) continue;
      var ref = el.getAttribute("data-agenos-ref") || "";
      if (!/^e\\d+$/.test(ref)) {
        counter += 1;
        ref = "e" + counter;
        try { el.setAttribute("data-agenos-ref", ref); } catch (e) { continue; }
      }
      var tagName = String(el.tagName || "").toLowerCase();
      var etype = String((el.getAttribute("type") || "")).toLowerCase();
      var value = etype === "password" ? "" : cut(el.value == null ? "" : el.value, 120);
      elements.push({
        ref: ref,
        tag: tagName,
        role: roleOf(el, tagName),
        name: cut(accessibleName(el), 120),
        value: value,
        placeholder: cut(el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || "", 120)
      });
    }

    return {
      ok: true,
      url: String(location.href || ""),
      title: String(document.title || ""),
      text: text,
      textTruncated: textTruncated,
      elements: elements,
      totalElements: total
    };
  } catch (error) {
    return { ok: false, reason: "script", detail: String(error && error.message ? error.message : error) };
  }
})()`;
}

export function buildInfoScript(): string {
  return `/*agenos:info*/(function(){
  try {
    return { ok: true, url: String(location.href || ""), title: String(document.title || ""), readyState: String(document.readyState || "") };
  } catch (error) {
    return { ok: false, reason: "script", detail: String(error && error.message ? error.message : error) };
  }
})()`;
}

export function buildClickScript(ref: string): string {
  return `/*agenos:click*/(function(){
  try {
${SCRIPT_HELPERS}
    var el = document.querySelector('[data-agenos-ref=' + JSON.stringify(${JSON.stringify(ref)}) + ']');
    if (!el) return { ok: false, reason: "sin-ref" };
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
    var label = describe(el);
    var href = el.getAttribute ? (el.getAttribute("href") || "") : "";
    try { el.focus({ preventScroll: true }); } catch (e) {}
    var rect = { left: 0, top: 0, width: 0, height: 0 };
    try { rect = el.getBoundingClientRect(); } catch (e) {}
    var opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("mousedown", opts)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent("pointerup", opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", opts)); } catch (e) {}
    el.click();
    return { ok: true, target: label, href: href };
  } catch (error) {
    return { ok: false, reason: "script", detail: String(error && error.message ? error.message : error) };
  }
})()`;
}

export function buildTypeScript(ref: string, text: string, clear: boolean): string {
  return `/*agenos:type*/(function(){
  try {
${SCRIPT_HELPERS}
    var VALUE = ${JSON.stringify(text)};
    var CLEAR = ${clear ? "true" : "false"};
    var el = document.querySelector('[data-agenos-ref=' + JSON.stringify(${JSON.stringify(ref)}) + ']');
    if (!el) return { ok: false, reason: "sin-ref" };
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
    try { el.focus({ preventScroll: true }); } catch (e) {}
    var label = describe(el);
    var tag = String(el.tagName || "").toLowerCase();
    var editable = el.getAttribute && el.getAttribute("contenteditable") === "true";

    if (tag === "input" || tag === "textarea") {
      var proto = tag === "input" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      var next = CLEAR ? VALUE : String(el.value == null ? "" : el.value) + VALUE;
      var setter = null;
      try {
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        setter = desc && desc.set ? desc.set : null;
      } catch (e) { setter = null; }
      if (setter) { setter.call(el, next); } else { el.value = next; }
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
      return { ok: true, target: label, mode: tag };
    }

    if (tag === "select") {
      var options = el.options || [];
      var picked = -1;
      for (var i = 0; i < options.length; i++) {
        var otext = clean(options[i].textContent);
        if (options[i].value === VALUE || otext === clean(VALUE)) { picked = i; break; }
      }
      if (picked < 0) {
        for (var k = 0; k < options.length; k++) {
          if (clean(options[k].textContent).toLowerCase().indexOf(clean(VALUE).toLowerCase()) >= 0) { picked = k; break; }
        }
      }
      if (picked < 0) return { ok: false, reason: "sin-opcion" };
      el.selectedIndex = picked;
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
      return { ok: true, target: label, mode: "select" };
    }

    if (editable) {
      if (CLEAR) {
        try { el.textContent = ""; } catch (e) {}
      }
      var inserted = false;
      try { inserted = document.execCommand("insertText", false, VALUE); } catch (e) { inserted = false; }
      if (!inserted) {
        try { el.textContent = (CLEAR ? "" : String(el.textContent || "")) + VALUE; } catch (e) {}
      }
      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, data: VALUE, inputType: "insertText" })); }
      catch (e) { try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e2) {} }
      return { ok: true, target: label, mode: "contenteditable" };
    }

    return { ok: false, reason: "no-escribible", target: label };
  } catch (error) {
    return { ok: false, reason: "script", detail: String(error && error.message ? error.message : error) };
  }
})()`;
}

export function buildWaitScript(text: string | undefined, ref: string | undefined): string {
  return `/*agenos:wait*/(function(){
  try {
    var NEEDLE = ${JSON.stringify(text ?? "")};
    var REF = ${JSON.stringify(ref ?? "")};
    var body = document.body ? String(document.body.innerText || document.body.textContent || "") : "";
    var haystack = body.replace(/\\s+/g, " ").toLowerCase();
    var textFound = NEEDLE ? haystack.indexOf(NEEDLE.replace(/\\s+/g, " ").toLowerCase()) >= 0 : null;
    var refFound = REF ? !!document.querySelector('[data-agenos-ref=' + JSON.stringify(REF) + ']') : null;
    return { ok: true, textFound: textFound, refFound: refFound, readyState: String(document.readyState || "") };
  } catch (error) {
    return { ok: false, reason: "script", detail: String(error && error.message ? error.message : error) };
  }
})()`;
}

export function buildExtractScript(selector: string, attribute: string | undefined, limit: number): string {
  return `/*agenos:extract*/(function(){
  try {
${SCRIPT_HELPERS}
    var SELECTOR = ${JSON.stringify(selector)};
    var ATTRIBUTE = ${JSON.stringify(attribute ?? "")};
    var LIMIT = ${Math.max(1, Math.floor(limit))};
    var nodes = null;
    try { nodes = document.querySelectorAll(SELECTOR); }
    catch (e) { return { ok: false, reason: "selector", detail: String(e && e.message ? e.message : e) }; }
    var out = [];
    var total = nodes.length;
    for (var i = 0; i < nodes.length && out.length < LIMIT; i++) {
      var el = nodes[i];
      var value = ATTRIBUTE
        ? (el.getAttribute(ATTRIBUTE) == null ? "" : String(el.getAttribute(ATTRIBUTE)))
        : clean(el.innerText || el.textContent);
      if (value) out.push(value);
    }
    return { ok: true, matches: out, total: total };
  } catch (error) {
    return { ok: false, reason: "script", detail: String(error && error.message ? error.message : error) };
  }
})()`;
}

// --------------------------------------------------------------------------------------
// Conector WebSocket por defecto (WebSocket global de Bun).
// --------------------------------------------------------------------------------------

async function defaultConnectWebSocket(url: string): Promise<CdpSocket> {
  const socket = new WebSocket(url);
  const listeners: Array<(data: string) => void> = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
    for (const listener of listeners) {
      listener(raw);
    }
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // Ignorado: solo intentamos liberar el socket.
      }
      reject(new Error(`No pude abrir el canal DevTools de la pestaña en ${CONNECT_TIMEOUT_MS} ms.`));
    }, CONNECT_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    socket.addEventListener("open", () => finish());
    socket.addEventListener("error", () => finish(new Error("El canal DevTools de la pestaña rechazó la conexión.")));
    socket.addEventListener("close", () => finish(new Error("El canal DevTools de la pestaña se cerró antes de abrirse.")));
  });

  return {
    send(payload: string) {
      socket.send(payload);
    },
    onMessage(cb: (data: string) => void) {
      listeners.push(cb);
    },
    close() {
      try {
        socket.close();
      } catch {
        // Ignorado: cerrar dos veces no es un error para nosotros.
      }
    },
    async ready() {
      // El socket ya está abierto cuando se resuelve connectWebSocket.
    },
  };
}

function createCdpSession(socket: CdpSocket, timeoutMs: number): CdpSession {
  let nextId = 0;
  let closed = false;
  const pending = new Map<number, PendingCommand>();

  socket.onMessage((data) => {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      return;
    }
    if (!message || typeof message.id !== "number") {
      // Es un evento del protocolo, no la respuesta a un comando.
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      const detail = typeof message.error.message === "string" ? message.error.message : "error sin detalle";
      entry.reject(new Error(`Chromium rechazó el comando DevTools: ${detail}`));
      return;
    }
    entry.resolve((message.result ?? {}) as Record<string, unknown>);
  });

  return {
    send(method, params) {
      if (closed) {
        return Promise.reject(new Error("El canal DevTools ya estaba cerrado."));
      }
      nextId += 1;
      const id = nextId;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`El comando ${method} de DevTools no respondió en ${timeoutMs} ms.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params: params ?? {} }));
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`No pude enviar el comando ${method} a Chromium: ${describeError(error, "canal roto")}`));
        }
      });
    },
    close() {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("El canal DevTools se cerró antes de recibir la respuesta."));
      }
      pending.clear();
      try {
        socket.close();
      } catch {
        // Ignorado: el socket puede estar cerrado ya.
      }
    },
  };
}

export function createWebController(deps: WebControllerDeps = {}): WebController {
  const port = deps.debugPort ?? DEFAULT_DEBUG_PORT;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const connectWebSocket = deps.connectWebSocket ?? defaultConnectWebSocket;
  const ensureBrowser = deps.ensureBrowser;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const commandTimeoutMs = deps.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const browserBootTimeoutMs = deps.browserBootTimeoutMs ?? DEFAULT_BROWSER_BOOT_TIMEOUT_MS;
  const readyTimeoutMs = deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

  const base = `http://127.0.0.1:${port}`;
  const portClosedMessage = `Chromium no responde en el puerto ${port} del protocolo DevTools. Hay que arrancarlo con --remote-debugging-port=${port}.`;
  let lastTargetId: string | null = null;

  async function httpJson(path: string, method: "GET" | "PUT"): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, { method, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Chromium respondió ${response.status} en ${path}.`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function listTargets(): Promise<CdpTargetInfo[]> {
    const payload = await httpJson("/json/list", "GET");
    if (!Array.isArray(payload)) {
      throw new Error("Chromium devolvió una lista de pestañas con un formato que no entiendo.");
    }
    return payload
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        id: String(entry.id ?? ""),
        type: String(entry.type ?? ""),
        title: String(entry.title ?? ""),
        url: String(entry.url ?? ""),
        webSocketDebuggerUrl: typeof entry.webSocketDebuggerUrl === "string" ? entry.webSocketDebuggerUrl : undefined,
      }));
  }

  function pageTargets(targets: CdpTargetInfo[]): CdpTargetInfo[] {
    return targets.filter((target) => target.type === "page"
      && !target.url.startsWith("devtools://")
      && !target.url.startsWith("chrome-extension://"));
  }

  function pickTarget(targets: CdpTargetInfo[], urlHint?: string): CdpTargetInfo | null {
    const pages = pageTargets(targets);
    if (pages.length === 0) {
      return null;
    }
    if (urlHint) {
      const exact = pages.find((target) => target.url === urlHint);
      if (exact) {
        return exact;
      }
      const partial = pages.find((target) => target.url.startsWith(urlHint) || urlHint.startsWith(target.url));
      if (partial) {
        return partial;
      }
    }
    if (lastTargetId) {
      const remembered = pages.find((target) => target.id === lastTargetId);
      if (remembered) {
        return remembered;
      }
    }
    return pages[0] ?? null;
  }

  async function isReachable(): Promise<boolean> {
    try {
      await listTargets();
      return true;
    } catch {
      return false;
    }
  }

  async function waitForPort(): Promise<boolean> {
    const started = now();
    for (;;) {
      if (await isReachable()) {
        return true;
      }
      if (now() - started >= browserBootTimeoutMs) {
        return false;
      }
      await sleep(pollIntervalMs);
    }
  }

  async function openSession(urlHint?: string): Promise<{ session: CdpSession; target: CdpTargetInfo }> {
    const targets = await listTargets();
    const target = pickTarget(targets, urlHint);
    if (!target) {
      throw new Error("Chromium responde pero no tiene ninguna pestaña normal abierta. Abre una web primero con la acción open.");
    }
    if (!target.webSocketDebuggerUrl) {
      throw new Error("La pestaña activa de Chromium no expone canal DevTools; ciérrala y vuelve a abrir la web.");
    }
    const socket = await connectWebSocket(target.webSocketDebuggerUrl);
    if (typeof socket.ready === "function") {
      await socket.ready();
    }
    lastTargetId = target.id;
    return { session: createCdpSession(socket, commandTimeoutMs), target };
  }

  async function withSession<T>(fn: (session: CdpSession, target: CdpTargetInfo) => Promise<T>, urlHint?: string): Promise<T> {
    const reachable = await isReachable();
    if (!reachable) {
      throw new Error(portClosedMessage);
    }
    const { session, target } = await openSession(urlHint);
    try {
      return await fn(session, target);
    } finally {
      session.close();
    }
  }

  async function evaluate<T>(session: CdpSession, expression: string): Promise<T> {
    const raw = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    const payload = raw as {
      result?: { value?: unknown; description?: unknown };
      exceptionDetails?: { text?: unknown; exception?: { description?: unknown } };
    };
    if (payload.exceptionDetails) {
      const detail = payload.exceptionDetails.exception?.description
        ?? payload.exceptionDetails.text
        ?? "error desconocido";
      throw new Error(`La página rechazó el script del agente: ${String(detail)}`);
    }
    return payload.result?.value as T;
  }

  async function readInfo(session: CdpSession): Promise<{ url: string; title: string; readyState: string }> {
    const info = await evaluate<{ url?: string; title?: string; readyState?: string } | undefined>(session, buildInfoScript());
    return {
      url: String(info?.url ?? ""),
      title: String(info?.title ?? ""),
      readyState: String(info?.readyState ?? ""),
    };
  }

  async function waitForDocumentReady(session: CdpSession): Promise<void> {
    const started = now();
    for (;;) {
      let readyState = "";
      try {
        readyState = (await readInfo(session)).readyState;
      } catch {
        readyState = "";
      }
      if (readyState === "complete" || readyState === "interactive") {
        return;
      }
      if (now() - started >= readyTimeoutMs) {
        return;
      }
      await sleep(pollIntervalMs);
    }
  }

  async function takeSnapshot(session: CdpSession, maxChars: number): Promise<WebSnapshot> {
    const raw = await evaluate<{
      ok?: boolean;
      reason?: string;
      detail?: string;
      url?: string;
      title?: string;
      text?: string;
      textTruncated?: boolean;
      elements?: unknown;
      totalElements?: number;
    } | undefined>(session, buildSnapshotScript(maxChars, MAX_SNAPSHOT_ELEMENTS));

    if (!raw || raw.ok !== true) {
      throw new Error(`No pude leer la página: ${raw?.detail ?? "el script de lectura no devolvió nada"}.`);
    }

    const elements: WebSnapshotElement[] = Array.isArray(raw.elements)
      ? raw.elements
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          ref: String(entry.ref ?? ""),
          tag: String(entry.tag ?? ""),
          role: String(entry.role ?? ""),
          name: String(entry.name ?? ""),
          value: String(entry.value ?? ""),
          placeholder: String(entry.placeholder ?? ""),
        }))
      : [];

    return {
      url: String(raw.url ?? ""),
      title: String(raw.title ?? ""),
      text: String(raw.text ?? ""),
      textTruncated: raw.textTruncated === true,
      elements,
      totalElements: typeof raw.totalElements === "number" ? raw.totalElements : elements.length,
    };
  }

  async function dispatchKey(session: CdpSession, key: string, modifiers: string[] | undefined): Promise<KeyDefinition> {
    const definition = resolveKeyDefinition(key);
    if (!definition) {
      throw new Error(`No sé enviar la tecla "${key}". Usa Enter, Tab, Escape, Backspace, Delete, las flechas o un solo carácter.`);
    }
    const mask = modifiersToBitmask(modifiers);
    const usesCommandModifier = (mask & MODIFIER_BITS.ctrl) !== 0 || (mask & MODIFIER_BITS.meta) !== 0;
    const named = NAMED_KEYS[key.trim().toLowerCase()] !== undefined;
    const textPayload = usesCommandModifier ? undefined : definition.text;

    if (named || !textPayload) {
      await session.send("Input.dispatchKeyEvent", {
        type: textPayload ? "keyDown" : "rawKeyDown",
        key: definition.key,
        code: definition.code,
        windowsVirtualKeyCode: definition.keyCode,
        nativeVirtualKeyCode: definition.keyCode,
        modifiers: mask,
        ...(textPayload ? { text: textPayload, unmodifiedText: textPayload } : {}),
      });
    } else {
      await session.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: definition.key,
        code: definition.code,
        windowsVirtualKeyCode: definition.keyCode,
        nativeVirtualKeyCode: definition.keyCode,
        modifiers: mask,
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "char",
        key: definition.key,
        text: textPayload,
        unmodifiedText: textPayload,
        modifiers: mask,
      });
    }

    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.keyCode,
      nativeVirtualKeyCode: definition.keyCode,
      modifiers: mask,
    });

    return definition;
  }

  const controller: WebController = {
    async status() {
      try {
        const targets = await listTargets();
        const pages = pageTargets(targets);
        return {
          ok: true,
          reachable: true,
          targets,
          message: pages.length > 0
            ? `Chromium responde en el puerto ${port} con ${pages.length} pestaña(s): ${pages.map((target) => target.url || target.title).slice(0, 5).join(", ")}.`
            : `Chromium responde en el puerto ${port} pero no tiene ninguna pestaña normal abierta.`,
        };
      } catch (error) {
        return {
          ok: false,
          reachable: false,
          targets: [],
          message: `${portClosedMessage} Detalle: ${describeError(error, "sin detalle")}`,
        };
      }
    },

    async open(url) {
      let normalized: string;
      try {
        normalized = normalizeWebUrl(url);
      } catch (error) {
        return { ok: false, message: describeError(error, "No pude entender la URL.") };
      }

      try {
        if (!(await isReachable())) {
          if (!ensureBrowser) {
            return { ok: false, message: portClosedMessage };
          }
          const launched = await ensureBrowser(normalized);
          if (!launched.ok) {
            return { ok: false, message: `No pude arrancar Chromium para manejar la web: ${launched.message}` };
          }
          if (!(await waitForPort())) {
            return {
              ok: false,
              message: `Chromium arrancó pero el puerto ${port} de DevTools sigue sin responder. Comprueba que se lanzó con --remote-debugging-port=${port}.`,
            };
          }
        }

        let targets = await listTargets();
        if (pageTargets(targets).length === 0) {
          await httpJson(`/json/new?${encodeURIComponent(normalized)}`, "PUT");
          targets = await listTargets();
        }

        const target = pickTarget(targets, normalized);
        if (!target) {
          return { ok: false, message: "Chromium está abierto pero no pude preparar ninguna pestaña para navegar." };
        }

        return await withSession(async (session) => {
          const before = await readInfo(session);
          if (before.url !== normalized) {
            await session.send("Page.navigate", { url: normalized });
          }
          await waitForDocumentReady(session);
          const info = await readInfo(session);
          return {
            ok: true,
            url: info.url || normalized,
            title: info.title,
            message: `Abrí ${info.url || normalized}${info.title ? ` (${info.title})` : ""}.`,
          } satisfies WebActionResult;
        }, normalized);
      } catch (error) {
        return { ok: false, message: `No pude abrir ${normalized}: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async snapshot(options) {
      const maxChars = options?.maxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS;
      try {
        return await withSession(async (session) => {
          const snapshot = await takeSnapshot(session, maxChars);
          return {
            ok: true,
            url: snapshot.url,
            title: snapshot.title,
            snapshot,
            text: formatSnapshot(snapshot),
            message: `Leí ${snapshot.url || "la página activa"} con ${snapshot.elements.length} elemento(s) interactivo(s).`,
          } satisfies WebSnapshotResult;
        });
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
        return await withSession(async (session) => {
          const result = await evaluate<{ ok?: boolean; reason?: string; detail?: string; target?: string; href?: string } | undefined>(
            session,
            buildClickScript(cleanRef),
          );
          if (!result || result.ok !== true) {
            if (result?.reason === "sin-ref") {
              return {
                ok: false,
                ref: cleanRef,
                message: `No existe ningún elemento con ref "${cleanRef}" en la página actual. Vuelve a pedir un snapshot y usa un ref de la lista nueva.`,
              } satisfies WebActionResult;
            }
            return {
              ok: false,
              ref: cleanRef,
              message: `No pude hacer clic en "${cleanRef}": ${result?.detail ?? "el script de clic falló"}.`,
            } satisfies WebActionResult;
          }
          return {
            ok: true,
            ref: cleanRef,
            target: result.target,
            message: `Hice clic en ${result.target ?? cleanRef}${result.href ? ` (enlace a ${truncateForModel(result.href, 120)})` : ""}.`,
          } satisfies WebActionResult;
        });
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
      const clear = options?.clear !== false;
      try {
        return await withSession(async (session) => {
          const result = await evaluate<{ ok?: boolean; reason?: string; detail?: string; target?: string; mode?: string } | undefined>(
            session,
            buildTypeScript(cleanRef, value, clear),
          );
          if (!result || result.ok !== true) {
            if (result?.reason === "sin-ref") {
              return {
                ok: false,
                ref: cleanRef,
                message: `No existe ningún elemento con ref "${cleanRef}" en la página actual. Pide un snapshot nuevo y usa un ref de la lista nueva.`,
              } satisfies WebActionResult;
            }
            if (result?.reason === "no-escribible") {
              return {
                ok: false,
                ref: cleanRef,
                message: `El elemento "${cleanRef}" (${result.target ?? "desconocido"}) no acepta texto. Haz clic en él primero o busca el campo de escritura real.`,
              } satisfies WebActionResult;
            }
            if (result?.reason === "sin-opcion") {
              return {
                ok: false,
                ref: cleanRef,
                message: `El desplegable "${cleanRef}" no tiene ninguna opción que coincida con "${truncateForModel(value, 60)}".`,
              } satisfies WebActionResult;
            }
            return {
              ok: false,
              ref: cleanRef,
              message: `No pude escribir en "${cleanRef}": ${result?.detail ?? "el script de escritura falló"}.`,
            } satisfies WebActionResult;
          }

          let submitNote = "";
          if (options?.submit === true) {
            await dispatchKey(session, "Enter", undefined);
            submitNote = " y pulsé Enter";
          }

          return {
            ok: true,
            ref: cleanRef,
            target: result.target,
            message: `Escribí "${truncateForModel(value, 120)}" en ${result.target ?? cleanRef}${submitNote}.`,
          } satisfies WebActionResult;
        });
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
        return await withSession(async (session) => {
          const definition = await dispatchKey(session, cleanKey, modifiers);
          const combo = [...(modifiers ?? []), definition.key].join("+");
          return { ok: true, message: `Pulsé ${combo}.` } satisfies WebActionResult;
        });
      } catch (error) {
        return { ok: false, message: `No pude pulsar "${cleanKey}": ${describeError(error, "fallo desconocido")}` };
      }
    },

    async waitFor(options) {
      const wantedText = options.text?.trim() ? options.text.trim() : undefined;
      const wantedRef = options.ref?.trim() ? options.ref.trim() : undefined;
      if (!wantedText && !wantedRef) {
        return { ok: false, message: "Dime qué esperar: un texto que deba aparecer o un ref que deba existir." };
      }
      const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? Math.min(options.timeoutMs, 120_000)
        : DEFAULT_WAIT_TIMEOUT_MS;

      try {
        return await withSession(async (session) => {
          const started = now();
          const script = buildWaitScript(wantedText, wantedRef);
          for (;;) {
            let found = false;
            try {
              const result = await evaluate<{ ok?: boolean; textFound?: boolean | null; refFound?: boolean | null } | undefined>(session, script);
              const textOk = wantedText ? result?.textFound === true : true;
              const refOk = wantedRef ? result?.refFound === true : true;
              found = Boolean(result?.ok) && textOk && refOk;
            } catch {
              found = false;
            }
            const elapsedMs = now() - started;
            if (found) {
              const info = await readInfo(session).catch(() => ({ url: "", title: "", readyState: "" }));
              return {
                ok: true,
                url: info.url,
                title: info.title,
                elapsedMs,
                message: `Apareció ${wantedText ? `el texto "${truncateForModel(wantedText, 80)}"` : `el elemento "${wantedRef}"`} tras ${elapsedMs} ms.`,
              } satisfies WebActionResult;
            }
            if (elapsedMs >= timeoutMs) {
              return {
                ok: false,
                elapsedMs,
                message: `Esperé ${elapsedMs} ms y ${wantedText ? `el texto "${truncateForModel(wantedText, 80)}"` : `el elemento "${wantedRef}"`} no apareció. La página puede seguir cargando o pedir que inicies sesión.`,
              } satisfies WebActionResult;
            }
            await sleep(pollIntervalMs);
          }
        });
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
        : DEFAULT_EXTRACT_LIMIT;
      try {
        return await withSession(async (session) => {
          const result = await evaluate<{ ok?: boolean; reason?: string; detail?: string; matches?: unknown; total?: number } | undefined>(
            session,
            buildExtractScript(cleanSelector, options?.attribute?.trim() || undefined, limit),
          );
          if (!result || result.ok !== true) {
            if (result?.reason === "selector") {
              return {
                ok: false,
                matches: [],
                message: `El selector "${cleanSelector}" no es válido: ${result.detail ?? "sintaxis incorrecta"}.`,
              } satisfies WebExtractResult;
            }
            return {
              ok: false,
              matches: [],
              message: `No pude extraer con "${cleanSelector}": ${result?.detail ?? "el script de extracción falló"}.`,
            } satisfies WebExtractResult;
          }
          const matches = Array.isArray(result.matches) ? result.matches.map((entry) => String(entry)) : [];
          return {
            ok: true,
            matches,
            message: matches.length > 0
              ? `Encontré ${matches.length} resultado(s) para "${cleanSelector}" (de ${result.total ?? matches.length} nodos).`
              : `El selector "${cleanSelector}" no encontró nada con texto en la página actual.`,
          } satisfies WebExtractResult;
        });
      } catch (error) {
        return { ok: false, matches: [], message: `No pude extraer con "${cleanSelector}": ${describeError(error, "fallo desconocido")}` };
      }
    },

    async screenshot(path) {
      const rawPath = String(path ?? "").trim();
      if (!rawPath) {
        return { ok: false, message: "Necesito la ruta donde guardar la captura, por ejemplo ~/Imagenes/captura.png." };
      }
      const target = expandUserPath(rawPath, homedir());
      try {
        return await withSession(async (session) => {
          const result = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          const data = (result as { data?: unknown }).data;
          if (typeof data !== "string" || !data) {
            return { ok: false, path: target, message: "Chromium no devolvió ninguna imagen para la captura." } satisfies WebActionResult;
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, Buffer.from(data, "base64"));
          return { ok: true, path: target, message: `Guardé la captura de la página en ${target}.` } satisfies WebActionResult;
        });
      } catch (error) {
        return { ok: false, path: target, message: `No pude guardar la captura en ${target}: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async back() {
      try {
        return await withSession(async (session) => {
          const history = await session.send("Page.getNavigationHistory");
          const entries = Array.isArray((history as { entries?: unknown }).entries)
            ? (history as { entries: Array<{ id?: unknown; url?: unknown }> }).entries
            : [];
          const currentIndex = typeof (history as { currentIndex?: unknown }).currentIndex === "number"
            ? (history as { currentIndex: number }).currentIndex
            : -1;
          if (currentIndex <= 0 || !entries[currentIndex - 1]) {
            return { ok: false, message: "No hay ninguna página anterior en el historial de esta pestaña." } satisfies WebActionResult;
          }
          await session.send("Page.navigateToHistoryEntry", { entryId: entries[currentIndex - 1]?.id });
          await waitForDocumentReady(session);
          const info = await readInfo(session);
          return { ok: true, url: info.url, title: info.title, message: `Volví atrás a ${info.url}.` } satisfies WebActionResult;
        });
      } catch (error) {
        return { ok: false, message: `No pude volver atrás: ${describeError(error, "fallo desconocido")}` };
      }
    },

    async reload() {
      try {
        return await withSession(async (session) => {
          await session.send("Page.reload", { ignoreCache: false });
          await waitForDocumentReady(session);
          const info = await readInfo(session);
          return { ok: true, url: info.url, title: info.title, message: `Recargué ${info.url}.` } satisfies WebActionResult;
        });
      } catch (error) {
        return { ok: false, message: `No pude recargar la página: ${describeError(error, "fallo desconocido")}` };
      }
    },
  };

  return controller;
}
