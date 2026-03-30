const { app, BrowserWindow, shell } = require("electron");

const APP_URL = process.env.AGENOS_INSTALLER_URL || "http://127.0.0.1:4173/";
const APP_KIND = process.env.AGENOS_APP_KIND || (APP_URL.includes("/system") ? "system" : "installer");
const WINDOW_TITLE = APP_KIND === "system" ? "AgenOS Live System" : "AgenOS Installer";

function configureCommandLine() {
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.commandLine.appendSwitch("disable-background-networking");
  app.commandLine.appendSwitch("disable-component-update");
  app.commandLine.appendSwitch("disable-default-apps");
  app.commandLine.appendSwitch("disable-features", "Translate,MediaRouter,OptimizationGuideModelDownloading");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("password-store", "basic");
}

configureCommandLine();

let mainWindow = null;

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
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setFullScreen(true);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(APP_URL);
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
