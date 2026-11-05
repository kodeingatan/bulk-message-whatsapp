import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { WhatsAppService } from "./whatsapp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let wa = null;
let dataFile = null;
let lastRows = [];
let saveTimer = null;

const MAX_IMPORT_ROWS = 10_000;

const STATUS_VALUES = new Set(["pending", "sending", "sent", "failed"]);

function getPaths() {
  const userData = app.getPath("userData");
  return {
    userData,
    authDir: app.isPackaged ? path.join(userData, "auth_info") : path.join(app.getAppPath(), "auth_info"),
    dataFile: path.join(userData, "bulk-whatsapp-data.json"),
  };
}

function normalizeStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (["done", "sent", "terkirim", "success", "sukses", "berhasil", "delivered"].includes(status)) {
    return "sent";
  }
  if (["failed", "gagal", "error", "fail"].includes(status)) return "failed";
  if (["sending", "mengirim"].includes(status)) return "pending";
  return "pending";
}

function excelStatus(status) {
  if (status === "sent") return "DONE";
  if (status === "failed") return "FAILED";
  return "PENDING";
}

function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : "";
  }
  return String(value).trim();
}

function pickField(source, keys) {
  const headers = Object.keys(source);
  for (const key of keys) {
    const found = headers.find((header) => header.trim().toLowerCase() === key);
    if (found !== undefined) {
      const value = source[found];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return "";
}

function mapExcelRow(source) {
  const phone = cellToString(
    pickField(source, [
      "wa number",
      "wa phone",
      "wa nomor",
      "nomor whatsapp",
      "nomor wa",
      "no whatsapp",
      "no wa",
      "phone",
      "phone number",
      "nomor",
      "no hp",
      "whatsapp",
    ]),
  );

  const message = cellToString(
    pickField(source, ["wa message", "wa pesan", "message", "pesan", "text", "keterangan"]),
  );

  const status = normalizeStatus(
    pickField(source, ["wa send status", "send status", "wa status", "status", "status kirim"]),
  );

  const sentAt = cellToString(pickField(source, ["sent at", "terkirim pada", "tanggal kirim"]));
  const error = cellToString(pickField(source, ["error", "keterangan gagal", "alasan gagal"]));

  return {
    id: randomUUID(),
    phone,
    message,
    status,
    sentAt,
    error,
  };
}

function sanitizeRow(row) {
  const status = STATUS_VALUES.has(row?.status) ? row.status : "pending";
  return {
    id: typeof row?.id === "string" && row.id ? row.id : randomUUID(),
    phone: String(row?.phone ?? ""),
    message: String(row?.message ?? ""),
    status: status === "sending" ? "pending" : status,
    sentAt: String(row?.sentAt ?? ""),
    error: String(row?.error ?? ""),
  };
}

function loadRowsFromDisk() {
  try {
    if (!dataFile || !fs.existsSync(dataFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
    if (!Array.isArray(rows)) return [];
    return rows.map(sanitizeRow);
  } catch {
    return [];
  }
}

function writeRowsNow() {
  if (!dataFile) return;
  try {
    const payload = JSON.stringify({ updatedAt: new Date().toISOString(), rows: lastRows }, null, 2);
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, dataFile);
  } catch (error) {
    console.error("Gagal menyimpan data:", error?.message || error);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeRowsNow, 350);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    backgroundColor: "#f3f6f4",
    title: "Bulk WA Sender",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.protocol !== "file:") event.preventDefault();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (wa) wa.connect().catch(() => {});
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("wa:connect", async () => wa.connect());
  ipcMain.handle("wa:status", async () => wa.getState());

  ipcMain.handle("wa:logout", async () => wa.logout());
  ipcMain.handle("wa:reset", async () => wa.reset());

  ipcMain.handle("wa:send", async (_event, payload) => {
    try {
      return await wa.send(payload?.phone, payload?.message);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle("rows:load", async () => {
    lastRows = loadRowsFromDisk();
    return { rows: lastRows };
  });

  ipcMain.handle("rows:save", async (_event, rows) => {
    if (!Array.isArray(rows)) return { ok: false, error: "Data tidak valid" };
    lastRows = rows.slice(0, MAX_IMPORT_ROWS).map(sanitizeRow);
    scheduleSave();
    return { ok: true };
  });

  ipcMain.handle("rows:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import file Excel",
      properties: ["openFile"],
      filters: [
        { name: "Excel / CSV", extensions: ["xlsx", "xls", "csv"] },
        { name: "Semua file", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePaths[0]) return { canceled: true, rows: [] };

    try {
      const filePath = result.filePaths[0];
      const workbook = XLSX.readFile(filePath, { cellDates: true });
      const sheetName = workbook.SheetNames.includes("WHATSAPPS")
        ? "WHATSAPPS"
        : workbook.SheetNames[0];

      if (!sheetName) return { canceled: false, error: "File Excel tidak memiliki sheet", rows: [] };

      const sheet = workbook.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
      const rows = raw
        .map(mapExcelRow)
        .filter((row) => row.phone || row.message)
        .slice(0, MAX_IMPORT_ROWS);

      return {
        canceled: false,
        rows,
        sheet: sheetName,
        fileName: path.basename(filePath),
        truncated: raw.length > MAX_IMPORT_ROWS,
      };
    } catch (error) {
      return {
        canceled: false,
        error: `Gagal membaca Excel: ${error?.message || error}`,
        rows: [],
      };
    }
  });

  ipcMain.handle("rows:export", async (_event, rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { canceled: false, error: "Tidak ada data untuk diexport" };
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export ke Excel",
      defaultPath: `bulk-whatsapp-${stamp}.xlsx`,
      filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    try {
      const header = ["WA Number", "WA Message", "WA Send Status", "Sent At", "Error"];
      const body = rows.map((row) => [
        row.phone || "",
        row.message || "",
        excelStatus(row.status),
        row.sentAt || "",
        row.error || "",
      ]);

      const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
      sheet["!cols"] = [{ wch: 20 }, { wch: 70 }, { wch: 16 }, { wch: 24 }, { wch: 36 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "WHATSAPPS");
      XLSX.writeFile(workbook, result.filePath);

      return { canceled: false, filePath: result.filePath };
    } catch (error) {
      return {
        canceled: false,
        error: `Gagal menyimpan Excel: ${error?.message || error}`,
      };
    }
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
    const paths = getPaths();
    dataFile = paths.dataFile;
    lastRows = loadRowsFromDisk();

    Menu.setApplicationMenu(null);

    wa = new WhatsAppService({
      authDir: paths.authDir,
      onEvent: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("wa:event", payload);
        }
      },
    });

    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    clearTimeout(saveTimer);
    writeRowsNow();
    wa?.destroy();
  });
}
