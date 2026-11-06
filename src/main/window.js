import path from "node:path";
import { app, BrowserWindow } from "electron";

export function createMainWindow({ preloadPath, indexPath, onDidFinishLoad }) {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    backgroundColor: "#f3f6f4",
    title: "Bulk WA Sender",
    icon: path.join(app.getAppPath(), "assets", "bulk-wa.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("will-navigate", (event, url) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    const devOrigin = rendererUrl ? new URL(rendererUrl).origin : null;
    if (target.protocol !== "file:" && target.origin !== devOrigin) event.preventDefault();
  });

  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });

  if (onDidFinishLoad) window.webContents.once("did-finish-load", onDidFinishLoad);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) window.loadURL(rendererUrl);
  else window.loadFile(indexPath);
  return window;
}
