import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, dirname, normalize } from "node:path";
import { resolveGraphicalSessionEnv } from "./session-env";

// Control del escritorio real (Sway/Wayland) para que el agente pueda usar
// aplicaciones nativas como una persona: mirar las ventanas, enfocar, escribir,
// pulsar atajos, mover el raton y hacer capturas.
//
// Ninguna funcion lanza hacia fuera: todas devuelven {ok, message} en espanol.
// Nada se ejecuta al importar el modulo.

export type DesktopRunResult = { ok: boolean; stdout: string; stderr: string; code: number | null };

export type DesktopControlDeps = {
  runCommand?: (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<DesktopRunResult>;
  commandExists?: (command: string) => boolean;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  now?: () => number;
};

export type DesktopGeometry = { x: number; y: number; width: number; height: number };

export type DesktopWindow = {
  id: number;
  appId: string;
  title: string;
  workspace: string;
  focused: boolean;
  floating: boolean;
  geometry: DesktopGeometry;
};

export type DesktopWorkspaceSummary = { name: string; focused: boolean; windows: number };

export type DesktopOutput = { name: string; active: boolean; focused: boolean; geometry: DesktopGeometry };

export type DesktopActionResult = { ok: boolean; message: string };

export type DesktopInspectResult = DesktopActionResult & {
  windows: DesktopWindow[];
  focusedWindow?: DesktopWindow;
  workspaces: DesktopWorkspaceSummary[];
  outputs: DesktopOutput[];
  summary: string;
};

export type DesktopWindowActionResult = DesktopActionResult & { id?: number };
export type DesktopTypeResult = DesktopActionResult & { text?: string };
export type DesktopKeysResult = DesktopActionResult & { combo?: string; args?: string[] };
export type DesktopMouseResult = DesktopActionResult & { x?: number; y?: number; button?: DesktopMouseButton };
export type DesktopScrollResult = DesktopActionResult & { direction?: DesktopScrollDirection; amount?: number };
export type DesktopScreenshotResult = DesktopActionResult & { path?: string };

export type DesktopCommandName = "swaymsg" | "wtype" | "ydotool" | "grim";

export type DesktopCapabilitiesResult = DesktopActionResult & {
  graphicalSession: boolean;
  waylandDisplay?: string;
  swaySock?: string;
  commands: Record<DesktopCommandName, boolean>;
  ydotoolDaemon: boolean;
  missing: string[];
  summary: string;
};

export type DesktopMouseButton = "left" | "right" | "middle";
export type DesktopScrollDirection = "up" | "down";

export const DEFAULT_DESKTOP_TIMEOUT_MS = 5000;

// El paquete Debian que hay que instalar en la ISO por cada binario.
export const DESKTOP_COMMAND_PACKAGES: Record<DesktopCommandName, string> = {
  swaymsg: "sway",
  wtype: "wtype",
  ydotool: "ydotool",
  grim: "grim",
};

const MAX_COMMAND_OUTPUT_BYTES = 512_000;

const MOUSE_BUTTON_CODES: Record<DesktopMouseButton, string> = {
  // ydotool: 0x00 izquierdo, 0x01 derecho, 0x02 central; 0x40 pulsar, 0x80 soltar.
  left: "0xC0",
  right: "0xC1",
  middle: "0xC2",
};

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  ctl: "ctrl",
  alt: "alt",
  meta: "alt",
  altgr: "altgr",
  shift: "shift",
  mayus: "shift",
  "mayús": "shift",
  super: "logo",
  win: "logo",
  windows: "logo",
  logo: "logo",
  cmd: "logo",
  command: "logo",
  capslock: "capslock",
};

const KEY_ALIASES: Record<string, string> = {
  enter: "Return",
  intro: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  tabulador: "Tab",
  del: "Delete",
  delete: "Delete",
  supr: "Delete",
  suprimir: "Delete",
  backspace: "BackSpace",
  retroceso: "BackSpace",
  borrar: "BackSpace",
  space: "space",
  espacio: "space",
  spacebar: "space",
  up: "Up",
  arriba: "Up",
  down: "Down",
  abajo: "Down",
  left: "Left",
  izquierda: "Left",
  right: "Right",
  derecha: "Right",
  home: "Home",
  inicio: "Home",
  end: "End",
  fin: "End",
  pageup: "Prior",
  pgup: "Prior",
  repag: "Prior",
  pagedown: "Next",
  pgdown: "Next",
  pgdn: "Next",
  avpag: "Next",
  insert: "Insert",
  insertar: "Insert",
  print: "Print",
  imprpant: "Print",
  menu: "Menu",
};

function defaultCommandExists(command: string): boolean {
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((pathEntry) => {
      try {
        accessSync(join(pathEntry, command), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }
  return "";
}

export function createDefaultDesktopRunCommand(env: NodeJS.ProcessEnv) {
  return function runCommand(
    command: string,
    args: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<DesktopRunResult> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        resolve({ ok: false, stdout: "", stderr: errorMessage(error), code: null });
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeoutMs = options.timeoutMs ?? DEFAULT_DESKTOP_TIMEOUT_MS;
      const append = (current: string, chunk: unknown) => (current + chunkToString(chunk)).slice(-MAX_COMMAND_OUTPUT_BYTES);

      const timer = timeoutMs > 0
        ? setTimeout(() => {
          child.kill("SIGTERM");
          settle({ ok: false, stdout, stderr, code: null });
        }, timeoutMs)
        : undefined;

      function settle(result: DesktopRunResult): void {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      }

      child.stdout?.on("data", (chunk) => {
        stdout = append(stdout, chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => {
        settle({ ok: false, stdout, stderr: stderr || errorMessage(error), code: null });
      });
      child.on("close", (code) => {
        settle({ ok: code === 0, stdout, stderr, code });
      });
    });
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Traduce un combo humano ("ctrl+s", "alt+Tab", "ctrl+shift+t", "Return")
 * a los argumentos exactos de wtype: -M <mod> ... -k <tecla> ... -m <mod>
 * liberando los modificadores en orden inverso.
 */
export function buildKeyComboArgs(combo: string): { ok: boolean; message: string; args: string[] } {
  const raw = typeof combo === "string" ? combo.trim() : "";
  if (!raw) {
    return { ok: false, message: "Indica que atajo quieres pulsar, por ejemplo 'ctrl+s' o 'Return'.", args: [] };
  }

  const parts = raw
    .split(/[+\-\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return { ok: false, message: `No entiendo el atajo '${raw}'.`, args: [] };
  }

  const modifiers: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    const candidate = parts[index] ?? "";
    const modifier = MODIFIER_ALIASES[candidate.toLowerCase()];
    if (!modifier) {
      return {
        ok: false,
        message: `No reconozco el modificador '${candidate}' en '${raw}'. Usa ctrl, alt, shift o super.`,
        args: [],
      };
    }
    if (!modifiers.includes(modifier)) {
      modifiers.push(modifier);
    }
  }

  const key = normalizeKeyName(parts[parts.length - 1] ?? "");
  if (!key) {
    return { ok: false, message: `No entiendo la tecla final de '${raw}'.`, args: [] };
  }

  const args: string[] = [];
  for (const modifier of modifiers) {
    args.push("-M", modifier);
  }
  args.push("-k", key);
  for (const modifier of [...modifiers].reverse()) {
    args.push("-m", modifier);
  }

  return { ok: true, message: `Atajo ${[...modifiers, key].join("+")}.`, args };
}

function normalizeKeyName(rawKey: string): string {
  const key = rawKey.trim();
  if (!key) {
    return "";
  }

  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) {
    return alias;
  }

  // F1..F12 se escriben en mayuscula como keysym de X.
  const functionKey = key.match(/^f([1-9]|1[0-2])$/i);
  if (functionKey) {
    return `F${functionKey[1]}`;
  }

  // Una sola letra o digito va tal cual (wtype la interpreta como keysym).
  return key;
}

type SwayNode = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  app_id?: unknown;
  pid?: unknown;
  focused?: unknown;
  rect?: unknown;
  window_rect?: unknown;
  window_properties?: { class?: unknown; title?: unknown } | null;
  nodes?: unknown;
  floating_nodes?: unknown;
};

function asNodeArray(value: unknown): SwayNode[] {
  return Array.isArray(value) ? (value.filter((node) => node && typeof node === "object") as SwayNode[]) : [];
}

function asGeometry(value: unknown): DesktopGeometry {
  const rect = (value ?? {}) as Record<string, unknown>;
  const read = (key: string) => (typeof rect[key] === "number" ? (rect[key] as number) : 0);
  return { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
}

function workspaceLabel(name: string): string {
  return name.startsWith("__i3") ? "scratchpad" : name;
}

/** Recorre el arbol completo de Sway (nodes + floating_nodes) y devuelve una lista plana de ventanas. */
export function parseSwayTree(tree: unknown): { windows: DesktopWindow[]; workspaces: DesktopWorkspaceSummary[] } {
  const windows: DesktopWindow[] = [];
  const workspaces: DesktopWorkspaceSummary[] = [];

  const walk = (node: SwayNode, workspace: string, floatingBranch: boolean): void => {
    const nodeType = typeof node.type === "string" ? node.type : "";
    const name = typeof node.name === "string" ? node.name : "";
    let currentWorkspace = workspace;

    if (nodeType === "workspace") {
      currentWorkspace = workspaceLabel(name);
      if (!name.startsWith("__i3")) {
        workspaces.push({ name, focused: node.focused === true, windows: 0 });
      }
    }

    const isFloating = floatingBranch || nodeType === "floating_con";
    if (isWindowNode(node, nodeType)) {
      const window = toDesktopWindow(node, currentWorkspace, isFloating);
      windows.push(window);
      const workspaceEntry = workspaces.find((candidate) => candidate.name === currentWorkspace);
      if (workspaceEntry) {
        workspaceEntry.windows += 1;
      }
    }

    for (const child of asNodeArray(node.nodes)) {
      walk(child, currentWorkspace, isFloating);
    }
    for (const child of asNodeArray(node.floating_nodes)) {
      walk(child, currentWorkspace, true);
    }
  };

  if (tree && typeof tree === "object") {
    walk(tree as SwayNode, "", false);
  }

  return { windows, workspaces };
}

function isWindowNode(node: SwayNode, nodeType: string): boolean {
  if (nodeType === "root" || nodeType === "output" || nodeType === "workspace" || nodeType === "dockarea") {
    return false;
  }
  if (typeof node.id !== "number") {
    return false;
  }

  const hasAppId = typeof node.app_id === "string" && node.app_id.trim() !== "";
  const hasClass = typeof node.window_properties?.class === "string" && String(node.window_properties?.class).trim() !== "";
  const hasPid = typeof node.pid === "number";
  return hasAppId || hasClass || hasPid;
}

function toDesktopWindow(node: SwayNode, workspace: string, floating: boolean): DesktopWindow {
  const appId = typeof node.app_id === "string" && node.app_id.trim()
    ? node.app_id.trim()
    : typeof node.window_properties?.class === "string"
      ? String(node.window_properties?.class).trim()
      : "desconocida";
  const title = typeof node.name === "string" && node.name.trim()
    ? node.name.trim()
    : typeof node.window_properties?.title === "string"
      ? String(node.window_properties?.title).trim()
      : "";

  return {
    id: node.id as number,
    appId,
    title,
    workspace: workspace || "desconocido",
    focused: node.focused === true,
    floating,
    geometry: asGeometry(node.rect ?? node.window_rect),
  };
}

export function describeWindows(windows: DesktopWindow[], workspaces: DesktopWorkspaceSummary[]): string {
  if (windows.length === 0) {
    return "No hay ninguna ventana abierta en el escritorio.";
  }

  const lines = [`Ventanas abiertas (${windows.length}):`];
  for (const window of windows) {
    const marks: string[] = [];
    if (window.focused) {
      marks.push("ENFOCADA");
    }
    if (window.floating) {
      marks.push("flotante");
    }
    const suffix = marks.length > 0 ? ` [${marks.join(", ")}]` : "";
    const title = window.title ? ` — "${window.title}"` : "";
    lines.push(`- id ${window.id}: ${window.appId}${title} (workspace ${window.workspace})${suffix}`);
  }

  if (workspaces.length > 0) {
    const rendered = workspaces
      .map((workspace) => `${workspace.name}${workspace.focused ? "*" : ""} (${workspace.windows})`)
      .join(", ");
    lines.push(`Workspaces: ${rendered}. El * marca el activo.`);
  }

  return lines.join("\n");
}

function timestampFor(now: () => number): string {
  const iso = new Date(now()).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

export function createDesktopController(deps: DesktopControlDeps = {}) {
  const env = resolveGraphicalSessionEnv(deps.env ?? process.env);
  const commandExists = deps.commandExists ?? defaultCommandExists;
  const runCommand = deps.runCommand ?? createDefaultDesktopRunCommand(env);
  const homeDir = deps.homeDir ?? env.HOME ?? homedir();
  const now = deps.now ?? Date.now;

  function hasGraphicalSession(): boolean {
    return Boolean(env.WAYLAND_DISPLAY || env.SWAYSOCK);
  }

  function sessionError(): string {
    return "No hay una sesion grafica de Sway disponible (falta WAYLAND_DISPLAY o SWAYSOCK), asi que no puedo controlar el escritorio.";
  }

  function missingCommandError(command: DesktopCommandName, action: string): string {
    return `Falta el binario '${command}' (paquete ${DESKTOP_COMMAND_PACKAGES[command]}) en el sistema, asi que no puedo ${action}.`;
  }

  function timeoutError(command: string, timeoutMs: number): string {
    return `El comando '${command}' no respondio en ${timeoutMs} ms y lo cancele; el escritorio puede estar bloqueado o el demonio no responde.`;
  }

  type Prepared = { ok: false; message: string } | { ok: true };

  function prepare(command: DesktopCommandName, action: string): Prepared {
    if (!hasGraphicalSession()) {
      return { ok: false, message: sessionError() };
    }
    if (!commandExists(command)) {
      return { ok: false, message: missingCommandError(command, action) };
    }
    return { ok: true };
  }

  async function run(
    command: string,
    args: string[],
    timeoutMs = DEFAULT_DESKTOP_TIMEOUT_MS,
  ): Promise<{ ok: boolean; message: string; result: DesktopRunResult }> {
    let result: DesktopRunResult;
    try {
      result = await runCommand(command, args, { timeoutMs });
    } catch (error) {
      const message = `No pude ejecutar '${command}': ${errorMessage(error)}`;
      return { ok: false, message, result: { ok: false, stdout: "", stderr: message, code: null } };
    }

    if (result.ok) {
      return { ok: true, message: "", result };
    }

    if (result.code === null) {
      const stderr = result.stderr.trim();
      const detail = stderr ? ` Detalle: ${stderr}` : "";
      return { ok: false, message: `${timeoutError(command, timeoutMs)}${detail}`, result };
    }

    const stderr = result.stderr.trim() || result.stdout.trim();
    const detail = stderr ? ` ${stderr}` : "";
    return { ok: false, message: `'${command}' fallo con codigo ${result.code}.${detail}`, result };
  }

  function swayReplyError(stdout: string): string | undefined {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      for (const entry of parsed) {
        const reply = entry as { success?: unknown; error?: unknown };
        if (reply && typeof reply === "object" && reply.success === false) {
          return typeof reply.error === "string" && reply.error.trim() ? reply.error.trim() : "Sway rechazo el comando.";
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  function emptyInspect(message: string): DesktopInspectResult {
    return { ok: false, message, windows: [], workspaces: [], outputs: [], summary: message };
  }

  async function readOutputs(): Promise<DesktopOutput[]> {
    const outcome = await run("swaymsg", ["-t", "get_outputs", "-r"]);
    if (!outcome.ok) {
      return [];
    }
    try {
      const parsed = JSON.parse(outcome.result.stdout) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((entry) => {
        const output = entry as Record<string, unknown>;
        return {
          name: typeof output.name === "string" ? output.name : "desconocida",
          active: output.active === true,
          focused: output.focused === true,
          geometry: asGeometry(output.rect),
        };
      });
    } catch {
      return [];
    }
  }

  async function inspect(): Promise<DesktopInspectResult> {
    const ready = prepare("swaymsg", "ver las ventanas abiertas");
    if (ready.ok === false) {
      return emptyInspect(ready.message);
    }

    const outcome = await run("swaymsg", ["-t", "get_tree", "-r"]);
    if (!outcome.ok) {
      return emptyInspect(`No pude leer las ventanas de Sway. ${outcome.message}`);
    }

    let tree: unknown;
    try {
      tree = JSON.parse(outcome.result.stdout);
    } catch {
      return emptyInspect("Sway devolvio un arbol de ventanas que no pude interpretar como JSON.");
    }

    const { windows, workspaces } = parseSwayTree(tree);
    const focusedWindow = windows.find((window) => window.focused);
    const outputs = await readOutputs();
    const summary = describeWindows(windows, workspaces);
    const focusLine = focusedWindow
      ? `Ventana enfocada: id ${focusedWindow.id} (${focusedWindow.appId}${focusedWindow.title ? ` — "${focusedWindow.title}"` : ""}) en el workspace ${focusedWindow.workspace}.`
      : "Ahora mismo no hay ninguna ventana enfocada.";

    return {
      ok: true,
      message: `${summary}\n${focusLine}`,
      windows,
      focusedWindow,
      workspaces,
      outputs,
      summary,
    };
  }

  function normalizeId(id: unknown): number | undefined {
    const value = typeof id === "string" && id.trim() !== "" ? Number(id) : id;
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
  }

  async function swayWindowCommand(
    id: unknown,
    swayAction: "focus" | "kill",
    humanAction: string,
  ): Promise<DesktopWindowActionResult> {
    const windowId = normalizeId(id);
    if (windowId === undefined) {
      return { ok: false, message: `Necesito el id numerico de la ventana para ${humanAction}. Llama antes a inspect.` };
    }

    const ready = prepare("swaymsg", humanAction);
    if (ready.ok === false) {
      return { ok: false, message: ready.message, id: windowId };
    }

    const outcome = await run("swaymsg", ["-r", `[con_id=${windowId}] ${swayAction}`]);
    if (!outcome.ok) {
      return { ok: false, message: `No pude ${humanAction}. ${outcome.message}`, id: windowId };
    }

    const replyError = swayReplyError(outcome.result.stdout);
    if (replyError) {
      return { ok: false, message: `Sway no pudo ${humanAction} (id ${windowId}): ${replyError}`, id: windowId };
    }

    return {
      ok: true,
      message: swayAction === "focus"
        ? `Ventana ${windowId} enfocada.`
        : `Pedi a la ventana ${windowId} que se cierre.`,
      id: windowId,
    };
  }

  async function focusWindow(id: unknown): Promise<DesktopWindowActionResult> {
    return swayWindowCommand(id, "focus", "enfocar la ventana");
  }

  async function closeWindow(id: unknown): Promise<DesktopWindowActionResult> {
    return swayWindowCommand(id, "kill", "cerrar la ventana");
  }

  async function typeText(text: unknown): Promise<DesktopTypeResult> {
    const value = typeof text === "string" ? text : "";
    if (value.trim() === "") {
      return { ok: false, message: "No hay texto que escribir: pasa el texto exacto que quieres teclear." };
    }

    const ready = prepare("wtype", "escribir texto en la ventana enfocada");
    if (ready.ok === false) {
      return { ok: false, message: ready.message, text: value };
    }

    // wtype interpreta los argumentos que empiezan por '-' como opciones,
    // asi que los guiones iniciales se envian como la tecla 'minus'.
    const args: string[] = [];
    let rest = value;
    while (rest.startsWith("-")) {
      args.push("-k", "minus");
      rest = rest.slice(1);
    }
    if (rest !== "") {
      args.push(rest);
    }

    const outcome = await run("wtype", args);
    if (!outcome.ok) {
      return { ok: false, message: `No pude escribir el texto. ${outcome.message}`, text: value };
    }

    return { ok: true, message: `Escribi ${value.length} caracteres en la ventana enfocada.`, text: value };
  }

  async function pressKeys(combo: unknown): Promise<DesktopKeysResult> {
    const raw = typeof combo === "string" ? combo : "";
    const translated = buildKeyComboArgs(raw);
    if (!translated.ok) {
      return { ok: false, message: translated.message, combo: raw };
    }

    const ready = prepare("wtype", `pulsar el atajo ${raw}`);
    if (ready.ok === false) {
      return { ok: false, message: ready.message, combo: raw, args: translated.args };
    }

    const outcome = await run("wtype", translated.args);
    if (!outcome.ok) {
      return { ok: false, message: `No pude pulsar '${raw}'. ${outcome.message}`, combo: raw, args: translated.args };
    }

    return { ok: true, message: `Pulse ${raw} en la ventana enfocada.`, combo: raw, args: translated.args };
  }

  function normalizeCoordinate(value: unknown): number | undefined {
    const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? Math.round(parsed) : undefined;
  }

  async function moveMouse(x: unknown, y: unknown): Promise<DesktopMouseResult> {
    const targetX = normalizeCoordinate(x);
    const targetY = normalizeCoordinate(y);
    if (targetX === undefined || targetY === undefined) {
      return { ok: false, message: "Para mover el raton necesito las coordenadas x e y en pixeles." };
    }

    const ready = prepare("ydotool", "mover el raton");
    if (ready.ok === false) {
      return { ok: false, message: ready.message, x: targetX, y: targetY };
    }

    const outcome = await run("ydotool", ["mousemove", "-a", "-x", String(targetX), "-y", String(targetY)]);
    if (!outcome.ok) {
      return { ok: false, message: `${ydotoolFailure(outcome.message)}`, x: targetX, y: targetY };
    }

    return { ok: true, message: `Raton en (${targetX}, ${targetY}).`, x: targetX, y: targetY };
  }

  function ydotoolFailure(detail: string): string {
    return `${detail} ydotool necesita el demonio 'ydotoold' en marcha y acceso a /dev/uinput; si no esta activo, el raton no se puede controlar.`;
  }

  async function click(
    button: DesktopMouseButton = "left",
    options: { x?: unknown; y?: unknown; double?: boolean } = {},
  ): Promise<DesktopMouseResult> {
    const normalizedButton: DesktopMouseButton = button === "right" || button === "middle" ? button : "left";
    const code = MOUSE_BUTTON_CODES[normalizedButton];

    const ready = prepare("ydotool", "hacer clic con el raton");
    if (ready.ok === false) {
      return { ok: false, message: ready.message, button: normalizedButton };
    }

    let movedTo: { x: number; y: number } | undefined;
    if (options.x !== undefined || options.y !== undefined) {
      const targetX = normalizeCoordinate(options.x);
      const targetY = normalizeCoordinate(options.y);
      if (targetX === undefined || targetY === undefined) {
        return {
          ok: false,
          message: "Si indicas una posicion para el clic, necesito x e y a la vez.",
          button: normalizedButton,
        };
      }
      const move = await moveMouse(targetX, targetY);
      if (!move.ok) {
        return move;
      }
      movedTo = { x: targetX, y: targetY };
    }

    const args = options.double === true ? ["click", code, code] : ["click", code];
    const outcome = await run("ydotool", args);
    if (!outcome.ok) {
      return {
        ok: false,
        message: ydotoolFailure(outcome.message),
        button: normalizedButton,
        x: movedTo?.x,
        y: movedTo?.y,
      };
    }

    const where = movedTo ? ` en (${movedTo.x}, ${movedTo.y})` : " en la posicion actual del puntero";
    const kind = options.double === true ? "Doble clic" : "Clic";
    return {
      ok: true,
      message: `${kind} ${normalizedButton}${where}.`,
      button: normalizedButton,
      x: movedTo?.x,
      y: movedTo?.y,
    };
  }

  async function scroll(direction: DesktopScrollDirection, amount: unknown = 3): Promise<DesktopScrollResult> {
    if (direction !== "up" && direction !== "down") {
      return { ok: false, message: "La direccion del scroll solo puede ser 'up' o 'down'." };
    }

    const steps = normalizeCoordinate(amount);
    const normalizedAmount = steps === undefined || steps <= 0 ? 3 : Math.min(steps, 50);

    const ready = prepare("ydotool", "usar la rueda del raton");
    if (ready.ok === false) {
      return { ok: false, message: ready.message, direction, amount: normalizedAmount };
    }

    // ydotool emite la rueda como evento relativo: REL_WHEEL positivo sube.
    const delta = direction === "up" ? normalizedAmount : -normalizedAmount;
    const outcome = await run("ydotool", ["mousemove", "-w", "-x", "0", "-y", String(delta)]);
    if (!outcome.ok) {
      return {
        ok: false,
        message: ydotoolFailure(outcome.message),
        direction,
        amount: normalizedAmount,
      };
    }

    return {
      ok: true,
      message: `Envie ${normalizedAmount} pasos de rueda hacia ${direction === "up" ? "arriba" : "abajo"}. Ojo: algunas aplicaciones invierten la rueda, asi que comprueba con una captura si el contenido se movio como esperabas.`,
      direction,
      amount: normalizedAmount,
    };
  }

  function expandPath(rawPath: string): string {
    const trimmed = rawPath.trim();
    if (trimmed === "~") {
      return homeDir;
    }
    if (trimmed.startsWith("~/")) {
      return join(homeDir, trimmed.slice(2));
    }
    if (isAbsolute(trimmed)) {
      return normalize(trimmed);
    }
    return join(homeDir, trimmed);
  }

  async function screenshot(path?: string, options: { output?: string } = {}): Promise<DesktopScreenshotResult> {
    const targetPath = typeof path === "string" && path.trim() !== ""
      ? expandPath(path)
      : join(homeDir, "Fotos", `agenos-captura-${timestampFor(now)}.png`);

    const ready = prepare("grim", "hacer una captura de pantalla");
    if (ready.ok === false) {
      return { ok: false, message: ready.message, path: targetPath };
    }

    const directory = dirname(targetPath);
    const mkdir = await run("mkdir", ["-p", directory]);
    if (!mkdir.ok) {
      return { ok: false, message: `No pude crear la carpeta ${directory}. ${mkdir.message}`, path: targetPath };
    }

    const args = options.output ? ["-o", options.output, targetPath] : [targetPath];
    const outcome = await run("grim", args);
    if (!outcome.ok) {
      return { ok: false, message: `No pude hacer la captura. ${outcome.message}`, path: targetPath };
    }

    return { ok: true, message: `Captura guardada en ${targetPath}.`, path: targetPath };
  }

  async function capabilities(): Promise<DesktopCapabilitiesResult> {
    const graphicalSession = hasGraphicalSession();
    const commands: Record<DesktopCommandName, boolean> = {
      swaymsg: commandExists("swaymsg"),
      wtype: commandExists("wtype"),
      ydotool: commandExists("ydotool"),
      grim: commandExists("grim"),
    };
    const missing = (Object.keys(commands) as DesktopCommandName[])
      .filter((command) => !commands[command])
      .map((command) => DESKTOP_COMMAND_PACKAGES[command]);

    let ydotoolDaemon = false;
    if (graphicalSession && commands.ydotool) {
      // Un movimiento relativo de 0 px no mueve nada pero obliga a hablar con ydotoold.
      const probe = await run("ydotool", ["mousemove", "-x", "0", "-y", "0"], 2000);
      ydotoolDaemon = probe.ok;
    }

    const lines: string[] = [];
    lines.push(graphicalSession
      ? `Sesion grafica detectada (WAYLAND_DISPLAY=${env.WAYLAND_DISPLAY ?? "sin definir"}).`
      : "No hay sesion grafica: sin ella no puedo controlar el escritorio.");
    lines.push(commands.swaymsg ? "swaymsg: puedo ver, enfocar y cerrar ventanas." : "swaymsg no esta instalado (paquete sway): no puedo ver ni cambiar de ventana.");
    lines.push(commands.wtype ? "wtype: puedo escribir texto y pulsar atajos." : "wtype no esta instalado (paquete wtype): no puedo escribir ni pulsar teclas.");
    if (!commands.ydotool) {
      lines.push("ydotool no esta instalado (paquete ydotool): no puedo mover ni pulsar el raton.");
    } else if (ydotoolDaemon) {
      lines.push("ydotool: el demonio ydotoold responde, puedo mover y pulsar el raton.");
    } else {
      lines.push("ydotool esta instalado pero ydotoold no responde: el raton no funcionara hasta que el demonio este activo.");
    }
    lines.push(commands.grim ? "grim: puedo hacer capturas de pantalla." : "grim no esta instalado (paquete grim): no puedo hacer capturas.");

    const summary = lines.join("\n");
    const ok = graphicalSession && commands.swaymsg;
    return {
      ok,
      message: summary,
      graphicalSession,
      waylandDisplay: env.WAYLAND_DISPLAY,
      swaySock: env.SWAYSOCK,
      commands,
      ydotoolDaemon,
      missing,
      summary,
    };
  }

  return {
    inspect,
    focusWindow,
    closeWindow,
    typeText,
    pressKeys,
    moveMouse,
    click,
    scroll,
    screenshot,
    capabilities,
  };
}

export type DesktopController = ReturnType<typeof createDesktopController>;
