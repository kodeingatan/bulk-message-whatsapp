import { ipcMain } from "electron";
import { exportExcel, importExcel, selectImportFile } from "./services/excel-service.js";
import { selectAttachments } from "./services/attachment-service.js";

export function registerIpcHandlers({ getWindow, whatsapp, rowsStore }) {
  ipcMain.handle("wa:connect", async () => whatsapp.connect());
  ipcMain.handle("wa:status", async () => whatsapp.getState());
  ipcMain.handle("wa:logout", async () => whatsapp.logout());
  ipcMain.handle("wa:reset", async () => whatsapp.reset());

  ipcMain.handle("wa:send", async (_event, payload) => {
    try {
      return await whatsapp.send(payload?.phone, payload?.message, payload?.attachments);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle("rows:load", async () => ({ rows: rowsStore.getRows() }));

  ipcMain.handle("rows:save", async (_event, rows) => rowsStore.save(rows));

  ipcMain.handle("datasets:load", async () => ({ datasets: rowsStore.getDatasets() }));

  ipcMain.handle("datasets:save", async (_event, datasets) => rowsStore.saveDatasets(datasets));

  ipcMain.handle("rows:import:select", async () => selectImportFile(getWindow()));

  ipcMain.handle("attachments:select", async () => {
    try {
      return await selectAttachments(getWindow());
    } catch (error) {
      return { canceled: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle("rows:import:sheet", async (_event, importId, sheetName) =>
    importExcel(importId, sheetName),
  );

  ipcMain.handle("rows:export", async (_event, rows, sheetName) =>
    exportExcel(getWindow(), rows, sheetName),
  );
}
