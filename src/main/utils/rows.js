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

const PHONE_HEADERS = new Set([
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
]);
const RECIPIENT_HEADERS = new Set([
  "wa from",
  "penerima",
  "nama penerima",
  "recipient",
  "recipient name",
  "contact name",
  "name",
  "nama",
]);
const MESSAGE_HEADERS = new Set([
  "wa message",
  "wa pesan",
  "message",
  "pesan",
  "text",
  "keterangan",
]);

function findSourceHeader(headers, aliases) {
  return headers.find((header) => aliases.has(header.trim().toLowerCase()));
}

function appendUniqueHeader(headers, requested) {
  let name = requested;
  let suffix = 2;
  while (headers.includes(name)) {
    name = `${requested} (${suffix})`;
    suffix += 1;
  }
  headers.push(name);
  return name;
}

export function buildExportRows(rows) {
  const headers = [];
  for (const row of rows) {
    for (const header of Object.keys(row?.sourceData ?? {})) {
      if (header.trim() && !headers.includes(header)) headers.push(header);
    }
  }

  const phoneHeader = findSourceHeader(headers, PHONE_HEADERS) ?? appendUniqueHeader(headers, "WA Number");
  const recipientHeader =
    findSourceHeader(headers, new Set(["wa from"])) ??
    findSourceHeader(headers, RECIPIENT_HEADERS) ??
    appendUniqueHeader(headers, "Penerima");
  const messageHeader =
    findSourceHeader(headers, MESSAGE_HEADERS) ?? appendUniqueHeader(headers, "WA Message");
  const statusHeader = appendUniqueHeader(headers, "WA Send Status");
  const sentAtHeader = appendUniqueHeader(headers, "WA Sent At");
  const errorHeader = appendUniqueHeader(headers, "WA Error");

  return [
    headers,
    ...rows.map((row) => {
      const sourceData = row?.sourceData ?? {};
      const values = { ...sourceData };
      values[phoneHeader] = row?.phone ?? "";
      values[recipientHeader] = row?.recipient ?? "";
      values[messageHeader] = row?.message ?? "";
      values[statusHeader] = excelStatus(row?.status);
      values[sentAtHeader] = row?.sentAt ?? "";
      values[errorHeader] = row?.error ?? "";
      return headers.map((header) => values[header] ?? "");
    }),
  ];
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

  const recipient = cellToString(
    pickField(source, ["wa from", "penerima", "nama penerima", "recipient", "recipient name", "contact name", "name", "nama"]),
  );

  const status = normalizeStatus(
    pickField(source, ["wa send status", "send status", "wa status", "status", "status kirim"]),
  );

  return {
    id: randomUUID(),
    phone,
    recipient,
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

export function sanitizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter(
      (attachment) =>
        attachment &&
        typeof attachment.path === "string" &&
        typeof attachment.name === "string" &&
        typeof attachment.mimeType === "string" &&
        ["image", "video", "audio", "document"].includes(attachment.kind),
    )
    .map((attachment) => ({
      path: attachment.path,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
    }));
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
    recipient: String(row?.recipient ?? ""),
    message: String(row?.message ?? ""),
    status: status === "sending" ? "pending" : status,
    sentAt: String(row?.sentAt ?? ""),
    error: String(row?.error ?? ""),
    ...(sourceData ? { sourceData } : {}),
    ...(Array.isArray(row?.attachments) ? { attachments: sanitizeAttachments(row.attachments) } : {}),
  };
}
