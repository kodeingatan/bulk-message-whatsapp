import { randomUUID } from "node:crypto";
import { ROW_STATUSES } from "../../shared/constants.js";

const STATUS_SET = new Set(ROW_STATUSES);

export function normalizeStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (["done", "sent", "terkirim", "success", "sukses", "berhasil", "delivered"].includes(status)) {
    return "sent";
  }
  if (["failed", "gagal", "error", "fail"].includes(status)) return "failed";
  return "pending";
}

export function excelStatus(status) {
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

function sourceCellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function pickField(source, keys) {
  const headers = Object.keys(source);
  for (const key of keys) {
    const found = headers.find((header) => header.trim().toLowerCase() === key);
    if (found === undefined) continue;
    const value = source[found];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

export function mapExcelRow(source) {
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

  return {
    id: randomUUID(),
    phone,
    message,
    status,
    sentAt: cellToString(pickField(source, ["sent at", "terkirim pada", "tanggal kirim"])),
    error: cellToString(pickField(source, ["error", "keterangan gagal", "alasan gagal"])),
    sourceData: Object.fromEntries(
      Object.entries(source).map(([header, value]) => [String(header).trim(), sourceCellToString(value)]),
    ),
  };
}

export function mergeWorksheetData(row, rowIndex, selectedSheetName, worksheetRows) {
  const sourceData = { ...row.sourceData };
  for (const [sheetName, rows] of worksheetRows) {
    if (sheetName === selectedSheetName) continue;
    const source = rows[rowIndex];
    if (!source) continue;
    for (const [header, value] of Object.entries(source)) {
      sourceData[`${sheetName} · ${String(header).trim()}`] = sourceCellToString(value);
    }
  }
  return { ...row, sourceData };
}

export function sanitizeRow(row) {
  const status = STATUS_SET.has(row?.status) ? row.status : "pending";
  const sourceData =
    row?.sourceData && typeof row.sourceData === "object" && !Array.isArray(row.sourceData)
      ? Object.fromEntries(
          Object.entries(row.sourceData)
            .filter(([header]) => header.trim())
            .map(([header, value]) => [header, String(value ?? "")]),
        )
      : undefined;
  return {
    id: typeof row?.id === "string" && row.id ? row.id : randomUUID(),
    phone: String(row?.phone ?? ""),
    message: String(row?.message ?? ""),
    status: status === "sending" ? "pending" : status,
    sentAt: String(row?.sentAt ?? ""),
    error: String(row?.error ?? ""),
    ...(sourceData ? { sourceData } : {}),
  };
}
