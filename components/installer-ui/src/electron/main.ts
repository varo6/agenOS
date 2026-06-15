import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain, shell } from "electron";

import { discoverDisks } from "../bun/installer/disks";
import type {
  ApiMessageResponse,
  PreflightResponse,
  ShellMode,
  SystemRuntimeInfo,
} from "../shared/installer-types";
import { createMaintenanceService } from "../shared/system-services/maintenance";
import { createPreflightService } from "../shared/system-services/preflight";
import { createSwitchModeService } from "../shared/system-services/switch-mode";
import {
  SYSTEM_IPC_CHANNELS,
  currentUid,
  isMaintenanceAction,
  isShellMode,
  normalizeBridgeMode,
  normalizeElectronGpuMode,
  readPersistedElectronGpuState,
  resolveElectronGpuState,
  shouldTrackGpuFallback,
  writePersistedElectronGpuState,
} from "../shared/system-services/runtime";
import { createNetworkManagerService } from "../../../network/node/network-manager";
import { NETWORK_IPC_CHANNELS, type ConnectWifiRequest } from "../../../network/types";

const APP_URL = process.env.AGENOS_INSTALLER_URL || "http://127.0.0.1:4173/";
const APP_KIND: ShellMode = isShellMode(process.env.AGENOS_APP_KIND)
  ? process.env.AGENOS_APP_KIND
  : APP_URL.includes("/system")
    ? "system"
    : "installer";
const WINDOW_TITLE = APP_KIND === "system" ? "AgenOS Live System" : "AgenOS Installer";
const BRIDGE_MODE = normalizeBridgeMode(process.env.AGENOS_SYSTEM_BRIDGE_MODE);
const REQUESTED_GPU_MODE = normalizeElectronGpuMode(process.env.AGENOS_ELECTRON_GPU_MODE);
const EFFECTIVE_GPU_STATE = resolveElectronGpuState({
  appKind: APP_KIND,
  requestedMode: REQUESTED_GPU_MODE,
  persistedState: readPersistedElectronGpuState(currentUid()),
});
const TRACK_GPU_FALLBACK = shouldTrackGpuFallback({
  appKind: APP_KIND,
  requestedMode: REQUESTED_GPU_MODE,
  effectiveState: EFFECTIVE_GPU_STATE,
});

const preflightService = createPreflightService({
  getDisks: discoverDisks,
});
const maintenanceService = createMaintenanceService();
const switchModeService = createSwitchModeService();
const networkService = createNetworkManagerService();

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let hasStableLoad = false;
let gpuFallbackPersisted = false;

function configureCommandLine(): void {
  if (EFFECTIVE_GPU_STATE === "off") {
    app.disableHardwareAcceleration();
  }

  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-background-networking");
  app.commandLine.appendSwitch("disable-component-update");
  app.commandLine.appendSwitch("disable-default-apps");
  app.commandLine.appendSwitch("disable-features", "Translate,MediaRouter,OptimizationGuideModelDownloading");
  if (EFFECTIVE_GPU_STATE === "off") {
    app.commandLine.appendSwitch("disable-gpu");
  }
  app.commandLine.appendSwitch("no-zygote");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("password-store", "basic");
}

configureCommandLine();

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeApiMessageResponse(response: ApiMessageResponse): ApiMessageResponse {
  return {
    ok: response.ok,
    message: response.message ?? (response.ok ? undefined : "La operación no se pudo completar."),
  };
}

function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return;
  }

  ipcRegistered = true;

  ipcMain.handle(NETWORK_IPC_CHANNELS.getStatus, () => networkService.getStatus());
  ipcMain.handle(NETWORK_IPC_CHANNELS.scanWifi, () => networkService.scanWifi());
  ipcMain.handle(NETWORK_IPC_CHANNELS.listAccessPoints, () => networkService.listAccessPoints());
  ipcMain.handle(NETWORK_IPC_CHANNELS.connectWifi, (_event, payload: ConnectWifiRequest) => (
    networkService.connectWifi({
      ssid: typeof payload?.ssid === "string" ? payload.ssid : "",
      bssid: typeof payload?.bssid === "string" ? payload.bssid : undefined,
      password: typeof payload?.password === "string" ? payload.password : undefined,
      hidden: payload?.hidden === true,
      device: typeof payload?.device === "string" ? payload.device : undefined,
    })
  ));
  ipcMain.handle(NETWORK_IPC_CHANNELS.disconnectWifi, () => networkService.disconnectWifi());
  ipcMain.handle(NETWORK_IPC_CHANNELS.setWifiEnabled, (_event, payload: { enabled?: unknown }) => (
    networkService.setWifiEnabled(payload?.enabled === true)
  ));

  if (APP_KIND !== "system") {
    return;
  }

  ipcMain.handle(SYSTEM_IPC_CHANNELS.getPreflight, async (): Promise<PreflightResponse> => {
    try {
      return preflightService.getPreflight();
    } catch (error) {
      throw new Error(normalizeErrorMessage(error));
    }
  });

  ipcMain.handle(SYSTEM_IPC_CHANNELS.runMaintenance, async (_event, action: unknown): Promise<ApiMessageResponse> => {
    if (!isMaintenanceAction(action)) {
      return {
        ok: false,
        message: "La acción debe ser terminal.",
      };
    }

    try {
      return normalizeApiMessageResponse(await maintenanceService.runMaintenance(action));
    } catch (error) {
      return {
        ok: false,
        message: normalizeErrorMessage(error),
      };
    }
  });

  ipcMain.handle(SYSTEM_IPC_CHANNELS.switchMode, async (_event, mode: unknown): Promise<ApiMessageResponse> => {
    if (!isShellMode(mode)) {
      return {
        ok: false,
        message: "El modo debe ser installer o system.",
      };
    }

    try {
      return normalizeApiMessageResponse(await switchModeService.switchMode(mode));
    } catch (error) {
      return {
        ok: false,
        message: normalizeErrorMessage(error),
      };
    }
  });

  ipcMain.handle(SYSTEM_IPC_CHANNELS.getRuntimeInfo, async (): Promise<SystemRuntimeInfo> => ({
    mode: BRIDGE_MODE,
    host: "electron",
    gpu: EFFECTIVE_GPU_STATE,
    version: app.getVersion(),
  }));
}

function showWindow(): void {
  if (!mainWindow) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setFullScreen(true);
}

function fallbackDocument(message: string, detail = ""): string {
  const escapeHtml = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(WINDOW_TITLE)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "DejaVu Sans", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #14100d;
        color: #f5efe7;
      }
      main {
        width: min(56rem, calc(100vw - 4rem));
        padding: 2rem;
        border-radius: 1rem;
        background: rgba(20, 16, 13, 0.92);
        box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 2rem;
      }
      p {
        margin: 0 0 1rem;
        line-height: 1.5;
      }
      pre {
        margin: 0;
        padding: 1rem;
        white-space: pre-wrap;
        background: rgba(0, 0, 0, 0.35);
        border-radius: 0.75rem;
        color: #f3d7a6;
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
  showWindow();
  void mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(fallbackDocument(message, detail))}`);
}

function appPathCandidates(relativePath: string): string[] {
  const appPath = app.getAppPath();
  const candidates = [
    resolve(appPath, relativePath),
    resolve(appPath, "..", relativePath),
    resolve(process.cwd(), "components", "installer-ui", "build", "electron", relativePath),
  ];

  return [...new Set(candidates)];
}

function resolveSystemIndexPath(): string | null {
  const configuredPath = process.env.AGENOS_SYSTEM_DIST_DIR?.trim();
  const candidates = [
    configuredPath ? resolve(configuredPath, "index.html") : null,
    ...appPathCandidates("../system-dist/index.html"),
    resolve(process.cwd(), "components", "ui", "dist", "index.html"),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePreloadPath(): string | null {
  const configuredPath = process.env.AGENOS_ELECTRON_PRELOAD?.trim();
  const candidates = [
    configuredPath ? resolve(configuredPath) : null,
    ...appPathCandidates("preload.cjs"),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function persistGpuFallback(reason: string, detail: string): void {
  if (!TRACK_GPU_FALLBACK || hasStableLoad || gpuFallbackPersisted) {
    return;
  }

  gpuFallbackPersisted = true;
  writePersistedElectronGpuState("off");
  console.error(`GPU fallback armed: ${reason}`, detail);
}

function markStableLoad(): void {
  if (hasStableLoad) {
    return;
  }

  hasStableLoad = true;
  if (TRACK_GPU_FALLBACK) {
    writePersistedElectronGpuState("on");
  }
}

async function loadMainContent(): Promise<void> {
  if (!mainWindow) {
    return;
  }

  if (APP_KIND === "installer") {
    await mainWindow.loadURL(APP_URL);
    return;
  }

  const indexPath = resolveSystemIndexPath();
  if (!indexPath) {
    showFallback(
      "No se encontró el build local de la shell del sistema.",
      "Se esperaba system-dist/index.html junto al runtime empaquetado.",
    );
    return;
  }

  await mainWindow.loadFile(indexPath);
}

function createMainWindow(): void {
  hasStableLoad = false;
  gpuFallbackPersisted = false;

  const preloadPath = APP_KIND === "system" ? resolvePreloadPath() : null;
  const hasPreload = Boolean(preloadPath);
  if (APP_KIND === "system" && !hasPreload) {
    console.error("No se encontró preload.cjs; la shell del sistema caerá a HTTP si lo necesita.");
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
      preload: hasPreload ? preloadPath ?? undefined : undefined,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    showWindow();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    markStableLoad();
    showWindow();
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    showFallback(
      "No se pudo cargar la interfaz gráfica.",
      `Destino: ${validatedURL || APP_URL}\nCodigo: ${errorCode}\nDetalle: ${errorDescription}`,
    );
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    persistGpuFallback("render-process-gone", JSON.stringify(details, null, 2));
    showFallback(
      "La interfaz gráfica se cerró inesperadamente.",
      JSON.stringify(details, null, 2),
    );
  });

  mainWindow.on("unresponsive", () => {
    persistGpuFallback("unresponsive", APP_KIND === "system" ? "system renderer" : APP_URL);
    showFallback(
      "La interfaz gráfica dejó de responder.",
      APP_KIND === "system" ? "system renderer" : APP_URL,
    );
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void loadMainContent().catch((error) => {
    showFallback(
      "No se pudo iniciar la interfaz gráfica.",
      normalizeErrorMessage(error),
    );
  });
}

app.on("child-process-gone", (_event, details) => {
  if (details.type === "GPU") {
    persistGpuFallback("gpu-process-gone", JSON.stringify(details, null, 2));
  }
});

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
