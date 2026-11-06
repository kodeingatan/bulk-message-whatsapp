import { clipboard, contextBridge, ipcRenderer } from "electron";
import type { BulkWAAPI, WhatsAppState } from "../shared/contracts.js";

const api: BulkWAAPI = {
  connect: () => ipcRenderer.invoke("wa:connect"),
  status: () => ipcRenderer.invoke("wa:status"),
  logout: () => ipcRenderer.invoke("wa:logout"),
  reset: () => ipcRenderer.invoke("wa:reset"),
  send: (payload) => ipcRenderer.invoke("wa:send", payload),
  loadRows: () => ipcRenderer.invoke("rows:load"),
  saveRows: (rows) => ipcRenderer.invoke("rows:save", rows),
  loadDatasets: () => ipcRenderer.invoke("datasets:load"),
  saveDatasets: (datasets) => ipcRenderer.invoke("datasets:save", datasets),
  selectImportFile: () => ipcRenderer.invoke("rows:import:select"),
  selectAttachments: () => ipcRenderer.invoke("attachments:select"),
  openResponsesFolder: () => ipcRenderer.invoke("responses:open-folder"),
  getResponseCaptureSettings: () => ipcRenderer.invoke("responses:get-settings"),
  saveResponseCaptureSettings: (settings) => ipcRenderer.invoke("responses:save-settings", settings),
  importSheet: (importId, sheetName) =>
    ipcRenderer.invoke("rows:import:sheet", importId, sheetName),
  exportRows: (rows, sheetName) => ipcRenderer.invoke("rows:export", rows, sheetName),
  copyText: (text) => clipboard.writeText(String(text ?? "")),
  onWAEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WhatsAppState & { type: "state" }) =>
      callback(payload);
    ipcRenderer.on("wa:event", listener);
    return () => ipcRenderer.removeListener("wa:event", listener);
  },
  onResponseCapture: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload);
    ipcRenderer.on("wa:response-capture", listener);
    return () => ipcRenderer.removeListener("wa:response-capture", listener);
  },
};

contextBridge.exposeInMainWorld("bulkWA", api);
