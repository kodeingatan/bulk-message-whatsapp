import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import pino from "pino";
import { Boom } from "@hapi/boom";
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { getAttachmentType } from "./attachment-types.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return "";

  let phone = String(raw).trim();
  if (!phone) return "";

  phone = phone.replace(/^whatsapp:/i, "").replace(/@.*$/, "");
  phone = phone.replace(/\D/g, "");

  if (!phone) return "";
  if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (/^8\d{7,11}$/.test(phone)) phone = `62${phone}`;

  return phone;
}

export function formatJidNumber(jid) {
  if (!jid) return "";
  return String(jid).split(":")[0].split("@")[0];
}

export class WhatsAppService {
  constructor({ authDir, onEvent = () => {} }) {
    this.authDir = authDir;
    this.onEvent = onEvent;
    this.sock = null;
    this.connecting = false;
    this.manualClose = false;
    this.reconnectTimer = null;
    this.qrSeq = 0;
    this.connectGeneration = 0;
    this.state = {
      connection: "idle",
      me: null,
      qr: null,
      message: "",
      updatedAt: Date.now(),
    };
  }

  getState() {
    return { ...this.state };
  }

  emit(patch) {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.onEvent({ type: "state", ...this.state });
  }

  scheduleReconnect(delay = 3000) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  async connect() {
    if (this.sock || this.connecting) return this.getState();

    const generation = ++this.connectGeneration;
    this.connecting = true;
    this.manualClose = false;
    this.emit({ connection: "connecting", me: null, qr: null, message: "Menyiapkan koneksi WhatsApp..." });

    try {
      fs.mkdirSync(this.authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      let version;
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        version = undefined;
      }

      const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
      });

      if (generation !== this.connectGeneration) {
        try {
          sock.end(undefined);
        } catch {
          // ignore
        }
        return this.getState();
      }

      this.sock = sock;
      this.connecting = false;

      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", (update) => {
        this.handleConnectionUpdate(update, sock).catch(() => {});
      });

      return this.getState();
    } catch (error) {
      if (generation !== this.connectGeneration) return this.getState();
      this.connecting = false;
      this.sock = null;
      this.emit({
        connection: "error",
        me: null,
        qr: null,
        message: error?.message || "Gagal memulai koneksi WhatsApp",
      });
      return this.getState();
    }
  }

  async handleConnectionUpdate({ connection, lastDisconnect, qr }, sourceSock) {
    if (!sourceSock || this.sock !== sourceSock) return;

    if (qr) {
      const seq = ++this.qrSeq;
      try {
        const dataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 360,
          errorCorrectionLevel: "M",
          color: { dark: "#0b1f16", light: "#ffffff" },
        });
        if (seq !== this.qrSeq || this.state.connection === "open" || this.sock !== sourceSock) return;
        this.emit({
          connection: "qr",
          me: null,
          qr: dataUrl,
          message: "Scan QR dengan WhatsApp di ponsel Anda",
        });
      } catch (error) {
        if (seq !== this.qrSeq || this.state.connection === "open" || this.sock !== sourceSock) return;
        this.emit({
          connection: "error",
          qr: null,
          message: `Gagal membuat QR: ${error?.message || error}`,
        });
      }
    }

    if (connection === "open") {
      this.qrSeq += 1;
      const me = this.sock?.user?.id || null;
      this.emit({
        connection: "open",
        me,
        qr: null,
        message: "Terhubung ke WhatsApp",
      });
      return;
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : undefined;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      this.qrSeq += 1;
      this.sock = null;

      if (loggedOut) {
        try {
          fs.rmSync(this.authDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }

      this.emit({
        connection: loggedOut ? "logged_out" : "closed",
        me: null,
        qr: null,
        message: loggedOut
          ? "Sesi WhatsApp berakhir. Scan QR untuk menghubungkan ulang."
          : "Koneksi terputus. Mencoba menghubungkan ulang...",
      });

      if (!this.manualClose && !loggedOut) this.scheduleReconnect(3000);
      else if (!this.manualClose && loggedOut) this.scheduleReconnect(1500);
    }
  }

  async logout() {
    this.connectGeneration += 1;
    this.qrSeq += 1;
    this.connecting = false;
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);

    try {
      if (this.sock) await this.sock.logout();
    } catch {
      // ignore
    }

    this.sock = null;

    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    this.emit({
      connection: "logged_out",
      me: null,
      qr: null,
      message: "Sesi dihapus. Klik Hubungkan untuk scan QR akun baru.",
    });

    return this.getState();
  }

  async reset() {
    this.connectGeneration += 1;
    this.qrSeq += 1;
    this.connecting = false;
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);

    try {
      this.sock?.end?.(undefined);
    } catch {
      // ignore
    }

    this.sock = null;

    await sleep(750);

    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    this.manualClose = false;
    return this.connect();
  }

  async send(phone, message, attachments = []) {
    const number = normalizePhone(phone);
    if (!number) throw new Error("Nomor WhatsApp tidak valid");
    if (number.length < 8) throw new Error("Nomor WhatsApp terlalu pendek");

    const text = String(message ?? "");
    if (!Array.isArray(attachments)) throw new Error("Daftar lampiran tidak valid");
    if (!text.trim() && !attachments.length) throw new Error("Pesan atau berkas harus diisi");

    if (!this.sock || this.state.connection !== "open") {
      throw new Error("WhatsApp belum terhubung");
    }

    const jid = `${number}@s.whatsapp.net`;
    const files = attachments.map((attachment) => {
      const filePath = typeof attachment?.path === "string" ? attachment.path : "";
      const type = getAttachmentType(filePath);
      if (!path.isAbsolute(filePath) || !type) {
        throw new Error(`Berkas lampiran tidak valid: ${attachment?.name || "tanpa nama"}`);
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`Berkas tidak ditemukan: ${path.basename(filePath)}`);
      }
      return { path: filePath, name: path.basename(filePath), ...type };
    });

    if (!text.trim() && !files.length) throw new Error("Pesan atau berkas harus diisi");

    let result;
    const captionIndex = text.trim()
      ? files.findIndex((file) => file.kind !== "audio")
      : -1;
    if (text.trim() && captionIndex === -1) {
      result = await this.sock.sendMessage(jid, { text });
    }

    for (const [index, file] of files.entries()) {
      const caption = index === captionIndex ? text : undefined;
      const media =
        file.kind === "image"
          ? { image: { url: file.path }, ...(caption ? { caption } : {}) }
          : file.kind === "video"
            ? { video: { url: file.path }, ...(caption ? { caption } : {}) }
            : file.kind === "audio"
              ? { audio: { url: file.path }, mimetype: file.mimeType }
              : {
                  document: { url: file.path },
                  mimetype: file.mimeType,
                  fileName: file.name,
                  ...(caption ? { caption } : {}),
                };
      result = await this.sock.sendMessage(jid, media);
    }

    return {
      ok: true,
      id: result?.key?.id || null,
      jid,
      number,
    };
  }

  destroy() {
    this.connectGeneration += 1;
    this.qrSeq += 1;
    this.connecting = false;
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);

    try {
      this.sock?.end?.(undefined);
    } catch {
      // ignore
    }

    this.sock = null;
  }
}
