import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePhone } from "../utils/phone.js";

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];
const DEFAULT_SETTINGS = {
  saveTextMessages: true,
  saveFiles: true,
  textMode: "template",
  textPattern: "",
  mediaTypes: MEDIA_TYPES,
  fileNamePattern: "",
};

function validatePattern(pattern, label) {
  if (pattern.length > 200) throw new Error(`${label} maksimal 200 karakter.`);
  if (!pattern) return;
  try {
    new RegExp(pattern, "i");
  } catch {
    throw new Error(`${label} bukan pola RegExp yang valid.`);
  }
}

function normalizeSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Pengaturan simpan balasan tidak valid.");
  }

  const textMode =
    settings.textMode === "template" || settings.textMode === "regex"
      ? settings.textMode
      : typeof settings.textPattern === "string" && settings.textPattern.trim()
        ? "regex"
        : DEFAULT_SETTINGS.textMode;
  const textPattern = typeof settings.textPattern === "string" ? settings.textPattern.trim() : "";
  const fileNamePattern =
    typeof settings.fileNamePattern === "string" ? settings.fileNamePattern.trim() : "";
  if (textMode === "regex") validatePattern(textPattern, "Pola teks");
  else getTemplateFields(textPattern);
  validatePattern(fileNamePattern, "Pola nama file");
  if (!Array.isArray(settings.mediaTypes) || settings.mediaTypes.some((type) => !MEDIA_TYPES.includes(type))) {
    throw new Error("Pilihan jenis file tidak valid.");
  }

  return {
    saveTextMessages: typeof settings.saveTextMessages === "boolean" ? settings.saveTextMessages : true,
    saveFiles: typeof settings.saveFiles === "boolean" ? settings.saveFiles : true,
    textMode,
    textPattern,
    mediaTypes: [...new Set(settings.mediaTypes)],
    fileNamePattern,
  };
}

function getTemplateFields(template) {
  if (!template) return [];
  const fields = template.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labels = fields.map((line) => {
    const separatorIndex = line.indexOf(":");
    const label = separatorIndex < 0 ? "" : line.slice(0, separatorIndex).trim();
    const placeholder = separatorIndex < 0 ? "" : line.slice(separatorIndex + 1).trim();
    if (!label || placeholder !== "...") {
      throw new Error('Format field harus ditulis "nama : ..." (satu field per baris).');
    }
    return label.replace(/\s+/g, " ").toLocaleLowerCase();
  });
  if (new Set(labels).size !== labels.length) {
    throw new Error("Nama field pada format pesan tidak boleh duplikat.");
  }
  return labels;
}

function matchesPattern(pattern, value) {
  return !pattern || new RegExp(pattern, "i").test(value);
}

function matchesText(text, settings) {
  if (!text || !settings.textPattern) return true;
  if (settings.textMode === "regex") return new RegExp(settings.textPattern, "i").test(text);

  const expectedLabels = getTemplateFields(settings.textPattern);
  if (!expectedLabels.length) return true;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let start = 0; start <= lines.length - expectedLabels.length; start += 1) {
    const matchesTemplate = expectedLabels.every((expectedLabel, index) => {
      const line = lines[start + index];
      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 0 || !line.slice(separatorIndex + 1).trim()) return false;
      const actualLabel = line.slice(0, separatorIndex).trim().replace(/\s+/g, " ");
      return actualLabel.toLocaleLowerCase() === expectedLabel;
    });
    if (matchesTemplate) return true;
  }
  return false;
}

function unwrapMessage(message = {}) {
  let content = message.message ?? {};
  for (let depth = 0; depth < 5; depth += 1) {
    const wrapper =
      content.ephemeralMessage ??
      content.viewOnceMessage ??
      content.viewOnceMessageV2 ??
      content.documentWithCaptionMessage;
    if (!wrapper?.message) break;
    content = wrapper.message;
  }
  return content;
}

function getMessageText(content) {
  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.templateButtonReplyMessage?.selectedDisplayText ??
    content.listResponseMessage?.title;
  return typeof text === "string" ? text.trim() : "";
}

function getMedia(content) {
  for (const [type, key] of [
    ["image", "imageMessage"],
    ["video", "videoMessage"],
    ["audio", "audioMessage"],
    ["document", "documentMessage"],
    ["sticker", "stickerMessage"],
  ]) {
    if (content[key]) return { type, message: content[key] };
  }
  return null;
}

function safeFolderName(value) {
  const cleaned = String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  if (!cleaned) return "";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}

function getRecipientName(row) {
  const waFrom = Object.entries(row.sourceData ?? {}).find(
    ([header]) => /wa from$/i.test(header.trim()),
  )?.[1];
  return String(waFrom || row.recipient || "").trim();
}

function mediaExtension(media) {
  const originalExtension = path.extname(String(media.fileName ?? "")).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(originalExtension)) return originalExtension;
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/3gpp": ".3gp",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
  };
  return extensions[String(media.mimetype ?? "").split(";")[0].toLowerCase()] ?? ".bin";
}

function getFileName(media, messageId, index) {
  const sourceName = path.basename(String(media.fileName ?? ""));
  const safeName = safeFolderName(sourceName);
  const safeId = safeFolderName(messageId) || String(Date.now());
  return `${safeId}-${safeName || `${index + 1}${mediaExtension(media)}`}`.slice(0, 150);
}

export class ResponseStore {
  constructor({ responsesDir, settingsFile, getDatasets, onCapture = () => {}, downloadMedia }) {
    this.responsesDir = responsesDir;
    this.settingsFile = settingsFile;
    this.getDatasets = getDatasets;
    this.onCapture = onCapture;
    this.downloadMedia = downloadMedia;
    this.settings = this.loadSettings();
    this.seenMessageIds = new Set();
    this.pendingMessages = new Map();
    this.writeQueues = new Map();
  }

  loadSettings() {
    if (!this.settingsFile) return { ...DEFAULT_SETTINGS, mediaTypes: [...DEFAULT_SETTINGS.mediaTypes] };
    try {
      return normalizeSettings(JSON.parse(fs.readFileSync(this.settingsFile, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { ...DEFAULT_SETTINGS, mediaTypes: [...DEFAULT_SETTINGS.mediaTypes] };
      }
      throw new Error(`Gagal memuat pengaturan simpan balasan: ${error?.message || error}`);
    }
  }

  getSettings() {
    return { ...this.settings, mediaTypes: [...this.settings.mediaTypes] };
  }

  saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    if (this.settingsFile) {
      fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
      const temporaryPath = `${this.settingsFile}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
        fs.renameSync(temporaryPath, this.settingsFile);
      } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
      }
    }
    this.settings = normalized;
    return { ok: true };
  }

  async appendRecord(jsonPath, record) {
    const previous = this.writeQueues.get(jsonPath) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      let messages = [];
      try {
        const content = await fs.promises.readFile(jsonPath, "utf8");
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) throw new Error(`Format file balasan tidak valid: ${jsonPath}`);
        messages = parsed;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      if (messages.some((message) => message.id === record.id)) return;
      messages.push(record);
      const temporaryPath = `${jsonPath}.${randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(temporaryPath, `${JSON.stringify(messages, null, 2)}\n`, "utf8");
        await fs.promises.rename(temporaryPath, jsonPath);
      } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true });
        throw error;
      }
    });
    this.writeQueues.set(jsonPath, write);
    try {
      await write;
    } finally {
      if (this.writeQueues.get(jsonPath) === write) this.writeQueues.delete(jsonPath);
    }
  }

  async saveIncomingMessage(message, downloadMedia = this.downloadMedia) {
    const messageId = message?.key?.id;
    const phone = normalizePhone(message?.key?.remoteJidAlt || message?.key?.remoteJid);
    const pendingKey = messageId && phone ? `${phone}:${messageId}` : null;
    if (!pendingKey) return this.persistIncomingMessage(message, downloadMedia);
    if (this.pendingMessages.has(pendingKey)) return this.pendingMessages.get(pendingKey);

    const pending = this.persistIncomingMessage(message, downloadMedia);
    this.pendingMessages.set(pendingKey, pending);
    try {
      return await pending;
    } finally {
      if (this.pendingMessages.get(pendingKey) === pending) this.pendingMessages.delete(pendingKey);
    }
  }

  async persistIncomingMessage(message, downloadMedia) {
    const key = message?.key;
    if (!key || key.fromMe || typeof key.remoteJid !== "string" || key.remoteJid.endsWith("@g.us")) {
      return [];
    }

    const phone = normalizePhone(key.remoteJidAlt || key.remoteJid);
    if (!phone) return [];
    const recipients = [];
    for (const dataset of this.getDatasets() ?? []) {
      const matchingRows = (dataset.rows ?? []).filter(
        (row) => row.saveResponse === true && normalizePhone(row.phone) === phone,
      );
      if (!matchingRows.length) continue;

      const tableFolder = safeFolderName(dataset.name) || safeFolderName(dataset.id) || "Tabel";
      for (const row of matchingRows) {
        const senderName = getRecipientName(row) || phone;
        const senderFolder = safeFolderName(senderName) || phone;
        const folderPath = path.join(this.responsesDir, tableFolder, senderFolder);
        if (!recipients.some((recipient) => recipient.folderPath === folderPath)) {
          recipients.push({ folderPath, senderName, tableName: dataset.name });
        }
      }
    }
    if (!recipients.length) return [];

    const messageId = String(key.id || randomUUID());
    const seenKey = `${phone}:${messageId}`;
    if (this.seenMessageIds.has(seenKey)) return [];

    const content = unwrapMessage(message);
    const originalText = getMessageText(content);
    const text =
      this.settings.saveTextMessages && matchesText(originalText, this.settings)
        ? originalText
        : "";
    const incomingMedia = getMedia(content);
    const originalFileName = incomingMedia
      ? path.basename(String(incomingMedia.message.fileName ?? ""))
      : "";
    const nameForMatching = originalFileName || (incomingMedia ? getFileName(incomingMedia.message, messageId, 0) : "");
    const media =
      this.settings.saveFiles &&
      incomingMedia &&
      this.settings.mediaTypes.includes(incomingMedia.type) &&
      matchesPattern(this.settings.fileNamePattern, nameForMatching)
        ? incomingMedia
        : null;
    if (!text && !media) return [];

    const timestamp = new Date(Number(message.messageTimestamp) * 1000 || Date.now()).toISOString();
    const saved = [];
    for (const recipient of recipients) {
      await fs.promises.mkdir(recipient.folderPath, { recursive: true });
      const files = [];
      if (media) {
        if (typeof downloadMedia !== "function") {
          throw new Error("Pengunduh berkas balasan WhatsApp tidak tersedia.");
        }
        const buffer = await downloadMedia(message);
        if (!Buffer.isBuffer(buffer)) throw new Error("Berkas balasan WhatsApp tidak dapat dibaca.");
        const fileName = getFileName(media.message, messageId, files.length);
        const filePath = path.join(recipient.folderPath, fileName);
        await fs.promises.writeFile(filePath, buffer);
        files.push({
          path: path.relative(recipient.folderPath, filePath).split(path.sep).join("/"),
          name: fileName,
          mimeType: String(media.message.mimetype ?? "application/octet-stream"),
          type: media.type,
        });
      }

      const record = {
        id: messageId,
        timestamp,
        from: phone,
        sender: recipient.senderName,
        text,
        files,
      };
      await this.appendRecord(path.join(recipient.folderPath, "messages.json"), record);
      saved.push({ phone, recipient: recipient.senderName, table: recipient.tableName });
    }

    this.seenMessageIds.add(seenKey);
    if (this.seenMessageIds.size > 5000) {
      this.seenMessageIds.delete(this.seenMessageIds.values().next().value);
    }
    for (const event of saved) this.onCapture({ ok: true, ...event });
    return saved;
  }

  openFolder(shell) {
    fs.mkdirSync(this.responsesDir, { recursive: true });
    return shell.openPath(this.responsesDir);
  }
}
