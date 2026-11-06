import path from "node:path";
import { randomUUID } from "node:crypto";
import { dialog } from "electron";
import XLSX from "xlsx";
import { MAX_IMPORT_ROWS } from "../../shared/constants.js";
import { validateSheetName } from "../../shared/excel.js";
import { buildExportRows, mapExcelRow, mergeWorksheetData } from "../utils/rows.js";

const pendingImports = new Map();
const IMPORT_EXPIRY_MS = 5 * 60 * 1000;

export async function selectImportFile(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import file Excel",
    properties: ["openFile"],
    filters: [
      { name: "Excel / CSV", extensions: ["xlsx", "xls", "csv"] },
      { name: "Semua file", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  try {
    const filePath = result.filePaths[0];
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetNames = workbook.SheetNames;

    if (!sheetNames.length) return { canceled: false, error: "File Excel tidak memiliki sheet" };

    const importId = randomUUID();
    const createdAt = Date.now();
    pendingImports.set(importId, { filePath, fileName: path.basename(filePath), sheetNames, createdAt });
    setTimeout(() => pendingImports.delete(importId), IMPORT_EXPIRY_MS).unref?.();
    for (const [id, pending] of pendingImports) {
      if (createdAt - pending.createdAt > IMPORT_EXPIRY_MS) pendingImports.delete(id);
    }

    return { canceled: false, importId, fileName: path.basename(filePath), sheetNames };
  } catch (error) {
    return {
      canceled: false,
      error: `Gagal membaca Excel: ${error?.message || error}`,
    };
  }
}

export async function importExcel(importId, requestedSheetName) {
  const pending = pendingImports.get(importId);
  if (!pending) {
    return { canceled: false, error: "Pilihan file import sudah kedaluwarsa. Silakan pilih file kembali." };
  }

  if (!pending.sheetNames.includes(requestedSheetName)) {
    return { canceled: false, error: "Sheet yang dipilih tidak ditemukan pada file Excel." };
  }

  pendingImports.delete(importId);

  try {
    const workbook = XLSX.readFile(pending.filePath, { cellDates: true });
    const sheetName = requestedSheetName;
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true, blankrows: true });
    const sheetRows = new Map(
      workbook.SheetNames.map((name) => [
        name,
        XLSX.utils.sheet_to_json(workbook.Sheets[name], {
          defval: "",
          raw: true,
          blankrows: true,
        }),
      ]),
    );
    const importedRows = raw
      .map((source, rowIndex) =>
        mergeWorksheetData(mapExcelRow(source), rowIndex, sheetName, sheetRows),
      )
      .filter((row) => row.phone || row.message);
    const rows = importedRows.slice(0, MAX_IMPORT_ROWS);

    return {
      canceled: false,
      rows,
      sheet: sheetName,
      fileName: pending.fileName,
      truncated: importedRows.length > MAX_IMPORT_ROWS,
    };
  } catch (error) {
    return {
      canceled: false,
      error: `Gagal membaca Excel: ${error?.message || error}`,
      rows: [],
    };
  }
}

export async function exportExcel(mainWindow, rows, requestedSheetName = "WHATSAPPS") {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { canceled: false, error: "Tidak ada data untuk diexport" };
  }

  const sheetName = String(requestedSheetName ?? "").trim();
  const sheetNameError = validateSheetName(sheetName);
  if (sheetNameError) return { canceled: false, error: sheetNameError };

  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export ke Excel",
    defaultPath: `bulk-whatsapp-${stamp}.xlsx`,
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    const exportData = buildExportRows(rows);
    const sheet = XLSX.utils.aoa_to_sheet(exportData);
    sheet["!cols"] = exportData[0].map((header) => ({
      wch: Math.min(60, Math.max(14, String(header).length + 4)),
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    XLSX.writeFile(workbook, result.filePath);

    return { canceled: false, filePath: result.filePath };
  } catch (error) {
    return {
      canceled: false,
      error: `Gagal menyimpan Excel: ${error?.message || error}`,
    };
  }
}
