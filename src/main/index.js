import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./ipc.js";
import { RowsStore } from "./services/rows-store.js";
import { WhatsAppService } from "./services/whatsapp-service.js";
import { getAppPaths } from "./utils/paths.js";
import { createMainWindow } from "./window.js";

let mainWindow = null;
let whatsapp = null;
let rowsStore = null;

function createWindow() {
  mainWindow = createMainWindow({
    preloadPath: path.join(__dirname, "../preload/index.mjs"),
    indexPath: path.join(__dirname, "../renderer/index.html"),
    onDidFinishLoad: () => {
      whatsapp.connect().catch(() => {});
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const paths = getAppPaths();

    rowsStore = new RowsStore({ dataFile: paths.dataFile });
    rowsStore.load();

    Menu.setApplicationMenu(null);

    whatsapp = new WhatsAppService({
      authDir: paths.authDir,
      onEvent: (payload) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("wa:event", payload);
      },
    });

    registerIpcHandlers({
      getWindow: () => mainWindow,
      whatsapp,
      rowsStore,
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    rowsStore?.flush();
    whatsapp?.destroy();
  });
}
