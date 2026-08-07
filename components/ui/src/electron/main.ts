import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { BrokerApiError, createBrokerPiClient, DEFAULT_BROKER_BASE_URL } from "./broker-pi-client";
import {
  PI_IPC_CHANNELS,
  SPEECH_IPC_CHANNELS,
  SYSTEM_IPC_CHANNELS,
  type SpeechCapturePhase,
} from "./ipc";
import type { ApiMessageResponse, PreflightResponse, ShellMode, SystemRuntimeInfo } from "../lib/system-types";
import { createNetworkManagerService } from "../../../network/node/network-manager";
import { NETWORK_IPC_CHANNELS, type ConnectWifiRequest } from "../../../network/types";

const WINDOW_TITLE = "AgenOS";
const BRIDGE_MODE = process.env.AGENOS_SYSTEM_BRIDGE_MODE?.trim().toLowerCase() === "http" ? "http" : "ipc";
const GPU_MODE = process.env.AGENOS_ELECTRON_GPU_MODE?.trim().toLowerCase() === "off" ? "off" : "on";
const BROKER_BASE_URL = process.env.AGENOS_AGENT_API_BASE?.trim() || DEFAULT_BROKER_BASE_URL;

type IpcEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; message: string };

type SpeechTranscriptionResponse = {
  transcript: string;
  engine: "whisper.cpp";
  language: "es";
  model: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

let mainWindow: BrowserWindow | null = null;
const networkService = createNetworkManagerService();
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

function resolveCommand(commandName: string, configuredPath: string | undefined, candidates: string[]): string | null {
  const trimmed = configuredPath?.trim();
  if (trimmed) {
    return trimmed;
  }

  const existing = firstExistingPath(candidates);
  if (existing) {
    return existing;
  }

  return commandName;
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

function parsePositiveInteger(value: string | undefined, fallback: number, options: { min: number; max: number }): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(options.max, Math.max(options.min, parsed));
}

function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolveCommandResult, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null, result?: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (error) {
        reject(error);
      } else {
        resolveCommandResult(result ?? { stdout: "", stderr: "" });
      }
    };

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`El comando ${command} excedio el tiempo limite.`));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };

      if (code === 0) {
        finish(null, result);
        return;
      }

      const detail = result.stderr.trim() || result.stdout.trim();
      finish(new Error(`${command} termino con codigo ${code ?? 1}${detail ? `: ${detail}` : "."}`));
    });
  });
}

function normalizeTranscript(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("whisper_") && !line.startsWith("main:") && !isNonSpeechTranscript(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonSpeechTranscript(line: string): boolean {
  const normalized = line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /^\[(musica|music|silencio|silence|aplausos|applause|ruido|noise|sonido)\]$/.test(normalized);
}

function resolveWhisperBinary(): string | null {
  const configuredPath = process.env.AGENOS_WHISPER_CPP_BIN?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const simdCandidates = [
    ...appPathCandidates("../whisper.cpp/whisper-cli"),
    "/opt/agenos/system/whisper.cpp/whisper-cli",
    "/usr/local/bin/whisper-cli",
    "/usr/bin/whisper-cli",
  ];
  const baselineCandidates = [
    ...appPathCandidates("../whisper.cpp/whisper-cli-baseline"),
    "/opt/agenos/system/whisper.cpp/whisper-cli-baseline",
  ];
  const packagedCandidates = cpuSupportsPackagedWhisperSimd()
    ? [...simdCandidates, ...baselineCandidates]
    : [...baselineCandidates, ...simdCandidates];

  return firstExistingPath(packagedCandidates) ?? "whisper-cli";
}

function cpuSupportsPackagedWhisperSimd(): boolean {
  if (process.env.AGENOS_STT_FORCE_BASELINE?.trim() === "1") {
    return false;
  }

  if (process.platform !== "linux" || process.arch !== "x64") {
    return true;
  }

  try {
    const flagsLine = readFileSync("/proc/cpuinfo", "utf8")
      .toLowerCase()
      .split(/\r?\n/)
      .find((line) => line.startsWith("flags"));
    const flags = new Set((flagsLine?.split(":")[1] ?? "").trim().split(/\s+/));

    return ["sse4_2", "avx", "avx2", "fma", "f16c", "bmi2"].every((flag) => flags.has(flag));
  } catch {
    return true;
  }
}

function resolveWhisperModel(): string | null {
  const configuredPath = process.env.AGENOS_WHISPER_MODEL?.trim();
  return firstExistingPath([
    configuredPath ? resolve(configuredPath) : null,
    ...appPathCandidates("../whisper.cpp/models/ggml-base.bin"),
    "/opt/agenos/system/whisper.cpp/models/ggml-base.bin",
  ]);
}

function resolveRecorderBinary(): string | null {
  return resolveCommand("arecord", process.env.AGENOS_STT_RECORDER_BIN, [
    "/usr/bin/arecord",
    "/bin/arecord",
  ]);
}

/** Avisa al renderer de en qué punto de la captura estamos. */
function emitSpeechPhase(phase: SpeechCapturePhase): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(SPEECH_IPC_CHANNELS.phase, phase);
}

async function transcribeOnce(): Promise<SpeechTranscriptionResponse> {
  const whisperBinary = resolveWhisperBinary();
  const modelPath = resolveWhisperModel();
  const recorderBinary = resolveRecorderBinary();

  if (!whisperBinary || !modelPath || !recorderBinary) {
    throw new Error("STT local no esta instalado. Falta whisper.cpp, el modelo base multilingue o arecord.");
  }

  const seconds = parsePositiveInteger(process.env.AGENOS_STT_RECORD_SECONDS, 4, { min: 2, max: 30 });
  const threads = parsePositiveInteger(process.env.AGENOS_STT_THREADS, Math.max(1, Math.min(4, cpus().length || 4)), { min: 1, max: 16 });
  const runtimeDir = await mkdtemp(join(tmpdir(), "agenos-stt-"));
  const wavPath = join(runtimeDir, "utterance.wav");
  const device = process.env.AGENOS_STT_ALSA_DEVICE?.trim() || "default";

  try {
    emitSpeechPhase("listening");
    await runCommand(recorderBinary, [
      "-q",
      "-D",
      device,
      "-t",
      "wav",
      "-f",
      "S16_LE",
      "-r",
      "16000",
      "-c",
      "1",
      "-d",
      String(seconds),
      wavPath,
    ], { timeoutMs: (seconds + 3) * 1000 });

    emitSpeechPhase("transcribing");
    const transcription = await runCommand(whisperBinary, [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "es",
      "-t",
      String(threads),
      "-nt",
      "-np",
    ], {
      timeoutMs: Math.max(20000, seconds * 12000),
      env: {
        LD_LIBRARY_PATH: [
          resolve(whisperBinary, "..", "lib"),
          process.env.LD_LIBRARY_PATH,
        ].filter(Boolean).join(":"),
      },
    });
    const transcript = normalizeTranscript(transcription.stdout);

    if (!transcript) {
      throw new Error("No se detecto voz. Intentalo otra vez o usa texto.");
    }

    return {
      transcript,
      engine: "whisper.cpp",
      language: "es",
      model: modelPath,
    };
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
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
      status: error instanceof BrokerApiError ? error.status : 500,
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
  ipcMain.handle(PI_IPC_CHANNELS.sendMessage, (_event, payload: { message?: unknown; source?: unknown }) => wrapPi(() => {
    const source = String(payload.source ?? "");
    if (source !== "text" && source !== "voice") {
      throw new BrokerApiError(400, "El origen debe ser text o voice.");
    }

    return getPiClient().chat({
      message: String(payload.message ?? ""),
      source,
    });
  }));
  ipcMain.handle(PI_IPC_CHANNELS.startTurn, (_event, payload: { message?: unknown; source?: unknown }) => wrapPi(() => {
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

  await mainWindow.loadURL(new URL("/", `${BROKER_BASE_URL}/`).toString());
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
    if (isHttpUrl(url)) {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:") || new URL(url).origin === new URL(BROKER_BASE_URL).origin) {
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
