import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  executableExists,
  launchGraphicalApplication,
  resolveExecutable,
  resolveTransientScopePrefix,
  type GraphicalLaunchResult,
  type RunCommand,
  type SpawnGraphicalCommand,
} from "./graphical-launcher";
import { resolveGraphicalSessionEnv } from "./session-env";

export type BrowserPlatform = "wayland" | "x11";

export type BrowserLauncherOptions = {
  commandExists?: (command: string) => boolean;
  spawnCommand?: SpawnGraphicalCommand;
  runCommand?: RunCommand;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  profileDir?: string;
  skipGraphicalSessionCheck?: boolean;
  workspace?: unknown;
  focus?: boolean;
  windowTimeoutMs?: number;
  pollIntervalMs?: number;
  coldStartMs?: number;
  existingWindowGraceMs?: number;
  disableGpu?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  uid?: number;
  logger?: Pick<Console, "warn">;
};

export type BrowserLaunchResult = GraphicalLaunchResult & {
  url: string;
  platform: BrowserPlatform;
  profileDir: string;
  profileCreated: boolean;
  securityDegraded: boolean;
  graphicsDegraded: boolean;
};

const BROWSER_COMMANDS = [
  "/usr/bin/chromium",
  "chromium",
  "/usr/bin/chromium-browser",
  "chromium-browser",
  "google-chrome-stable",
  "google-chrome",
  "/snap/bin/chromium",
];

const BROWSER_WINDOW_TOKENS = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "Chromium",
  "Google-chrome",
  "Google-chrome-stable",
];

export function normalizeBrowserUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("La URL es obligatoria.");
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http o https.");
  }

  return url.toString();
}

function hasGraphicalSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WAYLAND_DISPLAY || env.DISPLAY || env.SWAYSOCK);
}

function resolveProfileDir(options: BrowserLauncherOptions, env: NodeJS.ProcessEnv): string {
  if (options.profileDir?.trim()) {
    return options.profileDir.trim();
  }

  if (env.AGENOS_BROWSER_PROFILE_DIR?.trim()) {
    return env.AGENOS_BROWSER_PROFILE_DIR.trim();
  }

  return join(options.homeDir ?? homedir(), ".agenos", "browser-profile");
}

function browserEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GDK_BACKEND: env.GDK_BACKEND || "wayland,x11",
    MOZ_ENABLE_WAYLAND: env.MOZ_ENABLE_WAYLAND || "1",
    XDG_CURRENT_DESKTOP: env.XDG_CURRENT_DESKTOP || "AgenOS",
    XDG_SESSION_DESKTOP: env.XDG_SESSION_DESKTOP || "agenos",
  };
}

export function resolveBrowserPlatform(env: NodeJS.ProcessEnv): BrowserPlatform {
  const configured = env.AGENOS_BROWSER_OZONE_PLATFORM?.trim().toLowerCase();
  if (configured && configured !== "auto" && configured !== "wayland" && configured !== "x11") {
    throw new Error("AGENOS_BROWSER_OZONE_PLATFORM debe ser auto, wayland o x11.");
  }

  if (configured === "wayland") {
    if (!env.WAYLAND_DISPLAY) {
      throw new Error("Se pidió Chromium sobre Wayland, pero WAYLAND_DISPLAY no está disponible.");
    }
    return "wayland";
  }

  if (configured === "x11") {
    if (!env.DISPLAY) {
      throw new Error("Se pidió Chromium sobre X11/XWayland, pero DISPLAY no está disponible.");
    }
    return "x11";
  }

  return env.WAYLAND_DISPLAY ? "wayland" : "x11";
}

// El agente maneja la web por CDP, asi que el puerto de depuracion tiene que
// estar abierto siempre: si la primera ventana arranca sin el, el proceso dueno
// del perfil ya no lo expone y web_control se queda ciego el resto de la sesion.
// Queda atado a 127.0.0.1 por el propio Chromium.
export const CHROMIUM_DEBUG_PORT = 18800;

export function buildChromiumArgs(input: {
  url: string;
  profileDir: string;
  platform: BrowserPlatform;
  disableSandbox: boolean;
  disableGpu?: boolean;
  debugPort?: number;
}): string[] {
  const debugPort = input.debugPort ?? CHROMIUM_DEBUG_PORT;
  return [
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    `--ozone-platform=${input.platform}`,
    `--user-data-dir=${input.profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    // Sin esto Chromium rechaza con 403 los WebSocket que lleguen con cabecera
    // Origin; el puerto sigue escuchando solo en loopback.
    "--remote-allow-origins=*",
    ...(input.disableSandbox ? ["--no-sandbox"] : []),
    ...(input.disableGpu ? ["--disable-gpu"] : []),
    input.url,
  ];
}

export async function launchBrowserUrl(
  input: string,
  options: BrowserLauncherOptions = {},
): Promise<BrowserLaunchResult> {
  const env = browserEnv(resolveGraphicalSessionEnv(options.env ?? process.env));
  if (!options.skipGraphicalSessionCheck && !hasGraphicalSession(env)) {
    throw new Error("No hay una sesión gráfica Wayland/X11 disponible para abrir el navegador.");
  }

  const command = resolveExecutable(BROWSER_COMMANDS, env, options.commandExists);
  if (!command) {
    throw new Error("No encontré Chromium/Chrome instalado. Instala el paquete chromium y vuelve a intentarlo.");
  }

  const url = normalizeBrowserUrl(input);
  const platform = resolveBrowserPlatform(env);
  const profileDir = resolveProfileDir(options, env);
  const profileCreated = !existsSync(profileDir);
  if (profileCreated) {
    options.onProgress?.("Preparando el perfil persistente de Chromium para el primer arranque…");
  }
  try {
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    chmodSync(profileDir, 0o700);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No pude preparar el perfil de Chromium en ${profileDir}: ${detail}`);
  }

  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  const securityDegraded = uid === 0;
  if (securityDegraded) {
    const warning = "Chromium se iniciará con --no-sandbox porque la sesión se está ejecutando como root. Usa el usuario agenos para recuperar el aislamiento.";
    (options.logger ?? console).warn(`[browser-launcher] ${warning}`);
    options.onProgress?.(`Advertencia de seguridad: ${warning}`);
  }

  const graphicsDegraded = options.disableGpu
    ?? (env.AGENOS_BROWSER_DISABLE_GPU === "1" || env.WLR_RENDERER === "pixman");
  if (graphicsDegraded) {
    options.onProgress?.("Chromium usará renderizado por software para evitar una ventana negra en esta sesión.");
  }

  const launchOnPlatform = async (targetPlatform: BrowserPlatform, escapeServiceCgroup = true) => {
    const args = buildChromiumArgs({
      url,
      profileDir,
      platform: targetPlatform,
      disableSandbox: securityDegraded,
      disableGpu: graphicsDegraded,
    });
    const launch = await launchGraphicalApplication({
      command,
      args,
      env,
      escapeServiceCgroup,
      label: "Chromium",
      workspace: options.workspace ?? 3,
      focus: options.focus !== false,
      windowTokens: BROWSER_WINDOW_TOKENS,
      commandExists: options.commandExists,
      spawnCommand: options.spawnCommand,
      runCommand: options.runCommand,
      windowTimeoutMs: options.windowTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      coldStartMs: options.coldStartMs,
      existingWindowGraceMs: options.existingWindowGraceMs,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    return { args, launch };
  };

  let actualPlatform = platform;
  let { args, launch } = await launchOnPlatform(platform);
  const configuredPlatform = env.AGENOS_BROWSER_OZONE_PLATFORM?.trim().toLowerCase();
  const canFallbackToX11 = platform === "wayland"
    && Boolean(env.DISPLAY)
    && (!configuredPlatform || configuredPlatform === "auto")
    && launch.status === "failed";
  if (canFallbackToX11) {
    options.onProgress?.("Chromium falló sobre Wayland; reintentando mediante XWayland…");
    actualPlatform = "x11";
    const fallback = await launchOnPlatform(actualPlatform);
    args = fallback.args;
    launch = {
      ...fallback.launch,
      message: fallback.launch.ok
        ? `El arranque Wayland falló; ${fallback.launch.message} Se usó XWayland como respaldo.`
        : `Chromium falló sobre Wayland y también sobre XWayland. ${fallback.launch.message}`,
    };
  }

  // El scope de systemd es lo que hace que el navegador sobreviva a un reinicio
  // del broker, pero no vale a cambio de no abrirlo: si el gestor de usuario
  // acepta la conexión y aun así rechaza el scope, se reintenta sin él. El
  // usuario conserva la ventana; solo pierde el aislamiento del cgroup.
  const usedScope = resolveTransientScopePrefix({
    env,
    commandExists: options.commandExists ?? ((candidate: string) => executableExists(candidate, env)),
  }).length > 0;
  if (usedScope && launch.status === "failed") {
    options.onProgress?.("Chromium no arrancó en su propio scope de systemd; reintentando sin él…");
    const retry = await launchOnPlatform(actualPlatform, false);
    args = retry.args;
    launch = {
      ...retry.launch,
      message: retry.launch.ok
        ? `${retry.launch.message} Se lanzó fuera del scope de systemd, así que se cerrará si se reinicia el broker.`
        : retry.launch.message,
    };
  }

  return {
    ...launch,
    message: [
      launch.message,
      ...(securityDegraded
        ? ["Advertencia: Chromium se ejecutó sin sandbox porque el proceso de AgenOS es root."]
        : []),
      ...(graphicsDegraded
        ? ["Se desactivó la aceleración GPU porque Sway usa pixman o así lo pidió la configuración."]
        : []),
    ].join(" "),
    url,
    platform: actualPlatform,
    profileDir,
    profileCreated,
    securityDegraded,
    graphicsDegraded,
  };
}
