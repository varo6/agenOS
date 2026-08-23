import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { BrokerApiError, createBrokerPiClient, DEFAULT_BROKER_BASE_URL } from "./broker-pi-client";
import { loadPreferredFrontend } from "./frontend-loader";
import {
  PI_IPC_CHANNELS,
  SPEECH_IPC_CHANNELS,
  SYSTEM_IPC_CHANNELS,
  TTS_IPC_CHANNELS,
  type SpeechCapturePhase,
} from "./ipc";
import type { ApiMessageResponse, DisplayStatus, PreflightResponse, SystemRuntimeInfo } from "../lib/system-types";
import { createNetworkManagerService } from "../../../network/node/network-manager";
import { NETWORK_IPC_CHANNELS, type ConnectWifiRequest } from "../../../network/types";
import { createSystemIpcServices } from "./system-ipc-services";
import { createDisplayService } from "./display-service";
import { createLocalSpeechService, createSttRuntime } from "../../../stt";
import { createLocalTtsService, createTtsRuntime } from "../../../tts";
import type { SpeechTranscriptionOutcome } from "../lib/speech-bridge";
import type { TextToSpeechOutcome, TextToSpeechStatus } from "../lib/tts-bridge";

const WINDOW_TITLE = "AgenOS";
const BRIDGE_MODE = process.env.AGENOS_SYSTEM_BRIDGE_MODE?.trim().toLowerCase() === "http" ? "http" : "ipc";
const GPU_MODE = process.env.AGENOS_ELECTRON_GPU_MODE?.trim().toLowerCase() === "off" ? "off" : "on";
const BROKER_BASE_URL = process.env.AGENOS_AGENT_API_BASE?.trim() || DEFAULT_BROKER_BASE_URL;

type IpcEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; message: string };

let mainWindow: BrowserWindow | null = null;
const networkService = createNetworkManagerService();
const systemServices = createSystemIpcServices();
const displayService = createDisplayService();
type PiBrokerClient = ReturnType<typeof createBrokerPiClient>;
let piClient: PiBrokerClient | null = null;

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
  // Maximizada, no en fullscreen: el fullscreen esconde la barra de escritorios
  // de Sway y el usuario pierde de vista en que workspace esta. En tiling la
  // ventana ya ocupa todo el area util; maximize solo importa fuera de Sway.
  mainWindow.maximize();
}

function openExternalUrl(url: string): void {
  if (!isHttpUrl(url)) {
    console.warn(`URL externa bloqueada: ${url}`);
    return;
  }

  void getPiClient().openBrowserUrl(url)
    .then((result) => {
      if (!result.ok) {
        console.warn(`El broker no pudo abrir Chromium: ${result.message}`);
      }
    })
    .catch((error) => {
      console.warn(`El broker no pudo abrir la URL: ${normalizeErrorMessage(error)}`);
    });
}

function getPiClient(): PiBrokerClient {
  piClient ??= createBrokerPiClient({ baseUrl: BROKER_BASE_URL });
  return piClient;
}

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeApiMessageResponse(response: ApiMessageResponse): ApiMessageResponse {
  return {
    ok: response.ok,
    message: response.message ?? (response.ok ? undefined : "La operación no se pudo completar."),
  };
}

/**
 * Runtime del STT local, compartido con la ruta HTTP.
 *
 * Todo lo que antes vivia suelto en este fichero (rutas de binarios, deteccion
 * de SIMD, flags de Whisper, recorte de contexto) esta ahora en components/stt
 * para que Electron y el servidor no puedan divergir. El modelo se queda
 * cargado en whisper-server entre transcripciones.
 */
const sttRuntime = createSttRuntime({
  extraRoots: appPathCandidates("../whisper.cpp"),
  logger: (message) => console.log(`[stt] ${message}`),
});
const localSpeech = createLocalSpeechService(sttRuntime);
const ttsRuntime = createTtsRuntime();
const localTts = createLocalTtsService(ttsRuntime.settings, ttsRuntime.paths);

/** Avisa al renderer de en qué punto de la captura estamos. */
function emitSpeechPhase(phase: SpeechCapturePhase): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(SPEECH_IPC_CHANNELS.phase, phase);
}

async function transcribeOnce(): Promise<SpeechTranscriptionOutcome> {
  const result = await localSpeech.transcribeOnce((phase) => {
    emitSpeechPhase(phase);
  });

  // `=== false` y no `!result.ok`: tsconfig.node.json compila sin
  // strictNullChecks y ahi la forma corta no estrecha la union.
  if (result.ok === false) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    transcript: result.transcript,
    engine: result.engine,
    language: result.language,
    model: result.model,
  };
}

async function speakText(text: unknown): Promise<TextToSpeechOutcome> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { ok: true, engine: "espeak-ng", voice: ttsRuntime.settings.voice };
  }

  return localTts.speak(trimmed);
}

function wrapPi<T>(operation: () => T | Promise<T>): Promise<IpcEnvelope<T>> {
  return Promise.resolve()
    .then(operation)
    .then((value) => ({ ok: true, value }) satisfies IpcEnvelope<T>)
    .catch((error) => ({
      ok: false,
      status: error instanceof BrokerApiError ? error.status : 500,
      message: normalizeErrorMessage(error),
    }) satisfies IpcEnvelope<T>);
}

function registerIpcHandlers(): void {
  ipcMain.handle(SYSTEM_IPC_CHANNELS.getPreflight, async (): Promise<PreflightResponse> => systemServices.getPreflight());
  ipcMain.handle(SYSTEM_IPC_CHANNELS.runMaintenance, async (_event, action: unknown): Promise<ApiMessageResponse> => (
    normalizeApiMessageResponse(await systemServices.runMaintenance(action))
  ));
  ipcMain.handle(SYSTEM_IPC_CHANNELS.switchMode, async (_event, mode: unknown): Promise<ApiMessageResponse> => (
    normalizeApiMessageResponse(await systemServices.switchMode(mode))
  ));
  ipcMain.handle(SYSTEM_IPC_CHANNELS.getRuntimeInfo, async (): Promise<SystemRuntimeInfo> => ({
    mode: BRIDGE_MODE,
    host: "electron",
    gpu: GPU_MODE,
    version: app.getVersion(),
  }));
  ipcMain.handle(SYSTEM_IPC_CHANNELS.getDisplayStatus, async (): Promise<DisplayStatus> => displayService.getStatus());
  ipcMain.handle(SYSTEM_IPC_CHANNELS.setBrightness, async (_event, percent: unknown): Promise<ApiMessageResponse> => (
    displayService.setBrightness(percent)
  ));
  ipcMain.handle(SYSTEM_IPC_CHANNELS.turnOffDisplay, async (): Promise<ApiMessageResponse> => displayService.turnOff());

  ipcMain.handle(PI_IPC_CHANNELS.getStatus, () => wrapPi(() => getPiClient().getStatus()));
  ipcMain.handle(PI_IPC_CHANNELS.startAuth, (_event, payload: { method?: unknown }) => wrapPi(async () => {
    const method = String(payload?.method ?? "device");
    if (method !== "device" && method !== "browser") {
      throw new BrokerApiError(400, "El metodo de login debe ser device o browser.");
    }

    const attempt = await getPiClient().startAuth(method);
    if (method === "browser" && attempt.url) {
      openExternalUrl(attempt.url);
    }
    return attempt;
  }));
  ipcMain.handle(PI_IPC_CHANNELS.cancelAuth, (_event, payload: { attemptId?: unknown }) => wrapPi(() => {
    return getPiClient().cancelAuth(typeof payload?.attemptId === "string" ? payload.attemptId : undefined);
  }));
  ipcMain.handle(PI_IPC_CHANNELS.getAuthAttempt, (_event, payload: { attemptId?: unknown }) => wrapPi(() => (
    getPiClient().getAuthAttempt(String(payload.attemptId ?? ""))
  )));
  ipcMain.handle(PI_IPC_CHANNELS.submitManualCode, (_event, payload: { attemptId?: unknown; input?: unknown }) => wrapPi(() => (
    getPiClient().submitManualCode(String(payload.attemptId ?? ""), String(payload.input ?? ""))
  )));
  ipcMain.handle(PI_IPC_CHANNELS.logout, () => wrapPi(() => {
    return getPiClient().logout();
  }));
  ipcMain.handle(PI_IPC_CHANNELS.newConversation, () => wrapPi(() => {
    return getPiClient().startNewConversation();
  }));
  ipcMain.handle(PI_IPC_CHANNELS.sendMessage, (_event, payload: { message?: unknown; source?: unknown }) => wrapPi(async () => {
    const source = String(payload.source ?? "");
    if (source !== "text" && source !== "voice") {
      throw new BrokerApiError(400, "El origen debe ser text o voice.");
    }

    return getPiClient().chat({
      message: String(payload.message ?? ""),
      source,
    });
  }));
  ipcMain.handle(PI_IPC_CHANNELS.startTurn, (_event, payload: { message?: unknown; source?: unknown }) => wrapPi(async () => {
    const source = String(payload.source ?? "");
    if (source !== "text" && source !== "voice") {
      throw new BrokerApiError(400, "El origen debe ser text o voice.");
    }

    return getPiClient().startChat({
      message: String(payload.message ?? ""),
      source,
    });
  }));
  ipcMain.handle(PI_IPC_CHANNELS.getTurn, (_event, payload: { turnId?: unknown }) => wrapPi(() => (
    getPiClient().getTurn(String(payload.turnId ?? ""))
  )));
  ipcMain.handle(PI_IPC_CHANNELS.getLatestTurn, () => wrapPi(() => getPiClient().getLatestTurn()));
  ipcMain.handle(PI_IPC_CHANNELS.listTurns, (_event, payload: { limit?: unknown }) => wrapPi(() => (
    getPiClient().listTurns(typeof payload?.limit === "number" ? payload.limit : undefined)
  )));

  ipcMain.handle(SPEECH_IPC_CHANNELS.transcribeOnce, () => wrapPi(() => transcribeOnce()));
  ipcMain.handle(SPEECH_IPC_CHANNELS.cancel, () => wrapPi(() => {
    localSpeech.cancel();
  }));

  ipcMain.handle(TTS_IPC_CHANNELS.speak, (_event, payload: { text?: unknown }) => wrapPi(() => (
    speakText(payload?.text)
  )));
  ipcMain.handle(TTS_IPC_CHANNELS.stop, () => wrapPi(() => {
    localTts.stop();
  }));
  ipcMain.handle(TTS_IPC_CHANNELS.status, () => wrapPi<TextToSpeechStatus>(() => localTts.status()));

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

  const loadResult = await loadPreferredFrontend({
    brokerBaseUrl: BROKER_BASE_URL,
    localIndexPath: indexPath,
    loadUrl: (url) => mainWindow?.loadURL(url) ?? Promise.reject(new Error("La ventana principal ya no está disponible.")),
    loadFile: (path) => mainWindow?.loadFile(path) ?? Promise.reject(new Error("La ventana principal ya no está disponible.")),
  });

  if (loadResult === "local") {
    console.warn("El broker no estaba disponible durante el arranque; se cargó la interfaz local empaquetada.");
  }
}

function createMainWindow(): void {
  const preloadPath = resolvePreloadPath();
  if (!preloadPath) {
    console.error("No se encontró preload.cjs; la shell visual usará fallbacks web donde existan.");
  }

  mainWindow = new BrowserWindow({
    title: WINDOW_TITLE,
    show: true,
    backgroundColor: "#090b12",
    autoHideMenuBar: true,
    fullscreen: false,
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
    if (isHttpUrl(url)) {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:") || url.startsWith("file://") || new URL(url).origin === new URL(BROKER_BASE_URL).origin) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
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

/*
 * Al salir hay que soltar el micrófono y, si fue esta app quien levantó el
 * Whisper residente, cerrarlo también: si no, se queda un proceso de unos
 * 300 MB huérfano cada vez que se reinicia la shell durante el desarrollo.
 * Cuando el motor lo gestiona systemd, `dispose()` no toca nada.
 */
app.on("will-quit", () => {
  localSpeech.cancel();
  localTts.stop();
  sttRuntime.engine.dispose();
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
