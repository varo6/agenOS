import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain, shell } from "electron";

import { createPiHarness, PiHarnessError } from "../../dev/pi-harness";
import { launchBrowserUrl } from "../../../agent/browser-launcher";
import { PI_IPC_CHANNELS, SYSTEM_IPC_CHANNELS } from "./ipc";
import type { PiChatSource } from "../lib/pi-types";
import type { ApiMessageResponse, PreflightResponse, ShellMode, SystemRuntimeInfo } from "../lib/system-types";

const WINDOW_TITLE = "AgenOS";
const BRIDGE_MODE = process.env.AGENOS_SYSTEM_BRIDGE_MODE?.trim().toLowerCase() === "http" ? "http" : "ipc";
const GPU_MODE = process.env.AGENOS_ELECTRON_GPU_MODE?.trim().toLowerCase() === "off" ? "off" : "on";

type IpcEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; message: string };

let mainWindow: BrowserWindow | null = null;
const piHarness = createPiHarness(undefined, {
  onAuth: (info, attempt) => {
    if (attempt.method === "browser") {
      openExternalUrl(info.url);
    }
  },
});

function configureCommandLine(): void {
  if (GPU_MODE === "off") {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu");
  }

  app.setName("agenos-system-ui");
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-background-networking");
  app.commandLine.appendSwitch("disable-component-update");
  app.commandLine.appendSwitch("disable-default-apps");
  app.commandLine.appendSwitch("disable-features", "Translate,MediaRouter,OptimizationGuideModelDownloading");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("password-store", "basic");
}

configureCommandLine();

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appPathCandidates(relativePath: string): string[] {
  const appPath = app.getAppPath();
  return [...new Set([
    resolve(appPath, relativePath),
    resolve(appPath, "..", relativePath),
    resolve(process.cwd(), "components", "ui", "build", "electron", relativePath),
  ])];
}

function firstExistingPath(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveIndexPath(): string | null {
  const configuredPath = process.env.AGENOS_UI_DIST_DIR?.trim();
  return firstExistingPath([
    configuredPath ? resolve(configuredPath, "index.html") : null,
    ...appPathCandidates("../dist/index.html"),
    resolve(process.cwd(), "components", "ui", "dist", "index.html"),
  ]);
}

function resolvePreloadPath(): string | null {
  const configuredPath = process.env.AGENOS_ELECTRON_PRELOAD?.trim();
  return firstExistingPath([
    configuredPath ? resolve(configuredPath) : null,
    ...appPathCandidates("preload.cjs"),
  ]);
}

function fallbackDocument(message: string, detail = ""): string {
  const escapeHtml = (value: unknown) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(WINDOW_TITLE)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090b12;
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      main {
        width: min(42rem, calc(100vw - 3rem));
        padding: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0.75rem;
        background: rgba(255, 255, 255, 0.06);
      }
      pre {
        white-space: pre-wrap;
        color: rgba(255, 255, 255, 0.68);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(WINDOW_TITLE)}</h1>
      <p>${escapeHtml(message)}</p>
      ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
    </main>
  </body>
</html>`;
}

function showFallback(message: string, detail = ""): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  console.error(message, detail);
  void mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(fallbackDocument(message, detail))}`);
  mainWindow.show();
}

function showWindow(): void {
  if (!mainWindow) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setFullScreen(true);
}

function openExternalUrl(url: string): void {
  try {
    launchBrowserUrl(url);
  } catch (error) {
    console.warn(`No se pudo abrir Chromium directamente: ${normalizeErrorMessage(error)}`);
    void shell.openExternal(url);
  }
}

function normalizeApiMessageResponse(response: ApiMessageResponse): ApiMessageResponse {
  return {
    ok: response.ok,
    message: response.message ?? (response.ok ? undefined : "La operación no se pudo completar."),
  };
}

function createVisualPreflight(): PreflightResponse {
  return {
    firmware: existsSync("/sys/firmware/efi") ? "UEFI" : "BIOS",
    isLiveSession: existsSync("/run/live/medium"),
    totalRamBytes: 0,
    installableDiskBytes: 0,
    checks: [],
  };
}

function wrapPi<T>(operation: () => T | Promise<T>): Promise<IpcEnvelope<T>> {
  return Promise.resolve()
    .then(operation)
    .then((value) => ({ ok: true, value }) satisfies IpcEnvelope<T>)
    .catch((error) => ({
      ok: false,
      status: error instanceof PiHarnessError ? error.status : 500,
      message: normalizeErrorMessage(error),
    }) satisfies IpcEnvelope<T>);
}

function registerIpcHandlers(): void {
  ipcMain.handle(SYSTEM_IPC_CHANNELS.getPreflight, async (): Promise<PreflightResponse> => createVisualPreflight());
  ipcMain.handle(SYSTEM_IPC_CHANNELS.runMaintenance, async (): Promise<ApiMessageResponse> => normalizeApiMessageResponse({
    ok: true,
    message: "Mantenimiento no implementado en la shell visual nativa.",
  }));
  ipcMain.handle(SYSTEM_IPC_CHANNELS.switchMode, async (_event, mode: ShellMode): Promise<ApiMessageResponse> => normalizeApiMessageResponse({
    ok: mode === "installer" || mode === "system",
    message: mode === "installer" || mode === "system" ? `Modo ${mode} solicitado.` : "El modo debe ser installer o system.",
  }));
  ipcMain.handle(SYSTEM_IPC_CHANNELS.getRuntimeInfo, async (): Promise<SystemRuntimeInfo> => ({
    mode: BRIDGE_MODE,
    host: "electron",
    gpu: GPU_MODE,
    version: app.getVersion(),
  }));

  ipcMain.handle(PI_IPC_CHANNELS.getStatus, () => wrapPi(() => piHarness.getStatus()));
  ipcMain.handle(PI_IPC_CHANNELS.startAuth, (_event, payload: { method?: unknown }) => wrapPi(() => {
    const method = String(payload?.method ?? "device");
    if (method !== "device" && method !== "browser") {
      throw new PiHarnessError(400, "El metodo de login debe ser device o browser.");
    }

    return piHarness.startAuth(method);
  }));
  ipcMain.handle(PI_IPC_CHANNELS.cancelAuth, (_event, payload: { attemptId?: unknown }) => wrapPi(() => {
    piHarness.cancelAuth(typeof payload?.attemptId === "string" ? payload.attemptId : undefined);
  }));
  ipcMain.handle(PI_IPC_CHANNELS.getAuthAttempt, (_event, payload: { attemptId?: unknown }) => wrapPi(() => (
    piHarness.getAuthAttempt(String(payload.attemptId ?? ""))
  )));
  ipcMain.handle(PI_IPC_CHANNELS.submitManualCode, (_event, payload: { attemptId?: unknown; input?: unknown }) => wrapPi(() => (
    piHarness.submitManualCode(String(payload.attemptId ?? ""), String(payload.input ?? ""))
  )));
  ipcMain.handle(PI_IPC_CHANNELS.logout, () => wrapPi(() => {
    piHarness.logout();
  }));
  ipcMain.handle(PI_IPC_CHANNELS.sendMessage, (_event, payload: { message?: unknown; source?: unknown }) => wrapPi(() => {
    const source = String(payload.source ?? "");
    if (source !== "text" && source !== "voice") {
      throw new PiHarnessError(400, "El origen debe ser text o voice.");
    }

    return piHarness.chat({
      message: String(payload.message ?? ""),
      source: source as PiChatSource,
    });
  }));
}

async function loadMainContent(): Promise<void> {
  if (!mainWindow) {
    return;
  }

  const indexPath = resolveIndexPath();
  if (!indexPath) {
    showFallback("No se encontró el build local de AgenOS.", "Se esperaba dist/index.html junto al runtime de components/ui.");
    return;
  }

  await mainWindow.loadFile(indexPath);
}

function createMainWindow(): void {
  const preloadPath = resolvePreloadPath();
  if (!preloadPath) {
    console.error("No se encontró preload.cjs; la shell visual usará fallbacks web donde existan.");
  }

  mainWindow = new BrowserWindow({
    title: WINDOW_TITLE,
    show: false,
    backgroundColor: "#090b12",
    autoHideMenuBar: true,
    fullscreen: true,
    useContentSize: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      devTools: false,
      javascript: true,
      nodeIntegration: false,
      preload: preloadPath ?? undefined,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", showWindow);
  mainWindow.webContents.on("did-finish-load", showWindow);
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      showFallback("No se pudo cargar la interfaz gráfica.", `Destino: ${validatedURL}\nCodigo: ${errorCode}\nDetalle: ${errorDescription}`);
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    showFallback("La interfaz gráfica se cerró inesperadamente.", JSON.stringify(details, null, 2));
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void loadMainContent().catch((error) => {
    showFallback("No se pudo iniciar la interfaz gráfica.", normalizeErrorMessage(error));
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error) => {
  console.error(normalizeErrorMessage(error));
  app.exit(1);
});
