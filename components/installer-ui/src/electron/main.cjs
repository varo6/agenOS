const { app, BrowserWindow, shell } = require("electron");

const APP_URL = process.env.AGENOS_INSTALLER_URL || "http://127.0.0.1:4173/";
const APP_KIND = process.env.AGENOS_APP_KIND || (APP_URL.includes("/system") ? "system" : "installer");
const WINDOW_TITLE = APP_KIND === "system" ? "AgenOS Live System" : "AgenOS Installer";

function configureCommandLine() {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-background-networking");
  app.commandLine.appendSwitch("disable-component-update");
  app.commandLine.appendSwitch("disable-default-apps");
  app.commandLine.appendSwitch("disable-features", "Translate,MediaRouter,OptimizationGuideModelDownloading");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-zygote");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("password-store", "basic");
}

configureCommandLine();

let mainWindow = null;

function showWindow() {
  if (!mainWindow) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setFullScreen(true);
}

function fallbackDocument(message, detail = "") {
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
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

function showFallback(message, detail = "") {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  console.error(message, detail);
  showWindow();
  void mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(fallbackDocument(message, detail))}`);
}

function createMainWindow() {
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
    showWindow();
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || validatedURL !== APP_URL) {
      return;
    }

    showFallback(
      "No se pudo cargar la interfaz del instalador.",
      `URL: ${validatedURL}\nCodigo: ${errorCode}\nDetalle: ${errorDescription}`,
    );
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    showFallback(
      "La interfaz grafica del instalador se cerro inesperadamente.",
      JSON.stringify(details, null, 2),
    );
  });

  mainWindow.on("unresponsive", () => {
    showFallback(
      "La interfaz grafica del instalador dejo de responder.",
      APP_URL,
    );
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(APP_URL).catch((error) => {
    showFallback(
      "No se pudo iniciar la interfaz del instalador.",
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  app.exit(1);
});
