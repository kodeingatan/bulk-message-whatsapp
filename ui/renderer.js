const api = window.bulkWA;

const COLS = [
  { key: "phone", editable: true },
  { key: "message", editable: true },
  { key: "status", editable: false },
  { key: "sentAt", editable: false },
  { key: "error", editable: false },
];

const STATUS_LABEL = {
  pending: "Pending",
  sending: "Mengirim",
  sent: "Terkirim",
  failed: "Gagal",
};

const DEFAULT_ROWS = 3;

const els = {
  navItems: Array.from(document.querySelectorAll(".nav-item")),
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  pageWhatsapp: document.getElementById("page-whatsapp"),
  pageTable: document.getElementById("page-table"),

  navConnDot: document.getElementById("navConnDot"),
  sideStatusDot: document.getElementById("sideStatusDot"),
  sideStatusText: document.getElementById("sideStatusText"),
  sideStatusSub: document.getElementById("sideStatusSub"),
  connChip: document.getElementById("connChip"),
  connChipDot: document.getElementById("connChipDot"),
  connChipText: document.getElementById("connChipText"),
  connTag: document.getElementById("connTag"),
  connState: document.getElementById("connState"),
  connAccount: document.getElementById("connAccount"),

  qrPlaceholder: document.getElementById("qrPlaceholder"),
  qrPlaceholderText: document.getElementById("qrPlaceholderText"),
  qrSpinner: document.getElementById("qrSpinner"),
  qrImage: document.getElementById("qrImage"),
  qrSuccess: document.getElementById("qrSuccess"),
  qrSuccessText: document.getElementById("qrSuccessText"),

  btnConnect: document.getElementById("btnConnect"),
  btnLogout: document.getElementById("btnLogout"),
  btnReset: document.getElementById("btnReset"),

  statPending: document.getElementById("statPending"),
  statSent: document.getElementById("statSent"),
  statFailed: document.getElementById("statFailed"),
  tableBadge: document.getElementById("tableBadge"),

  logList: document.getElementById("logList"),
  btnClearLog: document.getElementById("btnClearLog"),

  gridBody: document.getElementById("gridBody"),
  gridWrap: document.getElementById("gridWrap"),
  emptyState: document.getElementById("emptyState"),
  btnEmptyAdd: document.getElementById("btnEmptyAdd"),
  btnEmptyImport: document.getElementById("btnEmptyImport"),

  btnSend: document.getElementById("btnSend"),
  btnStop: document.getElementById("btnStop"),
  sendProgress: document.getElementById("sendProgress"),
  sendProgressBar: document.getElementById("sendProgressBar"),
  sendProgressText: document.getElementById("sendProgressText"),
  btnAddRow: document.getElementById("btnAddRow"),
  btnDeleteRows: document.getElementById("btnDeleteRows"),
  btnImport: document.getElementById("btnImport"),
  btnExport: document.getElementById("btnExport"),
  delayInput: document.getElementById("delayInput"),
  skipSent: document.getElementById("skipSent"),

  toastStack: document.getElementById("toastStack"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalMessage: document.getElementById("modalMessage"),
  modalCancel: document.getElementById("modalCancel"),
  modalConfirm: document.getElementById("modalConfirm"),
};

const state = {
  rows: [],
  page: "whatsapp",
  wa: { connection: "idle", qr: null, me: null, message: "" },
  lastConnection: null,
  active: null,
  anchor: null,
  selection: null,
  selectedCells: [],
  editor: null,
  sending: false,
  stopRequested: false,
  saveTimer: null,
  modalResolve: null,
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const sleepChunk = (ms) =>
  new Promise((resolve) => {
    if (ms <= 0) return resolve();
    let elapsed = 0;
    const step = 200;
    const timer = setInterval(() => {
      elapsed += step;
      if (state.stopRequested || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, Math.min(step, ms));
  });

function newRow(phone = "", message = "", status = "pending") {
  return { id: uid(), phone, message, status, sentAt: "", error: "" };
}

function normalizeRow(row) {
  const status = ["pending", "sent", "failed"].includes(row?.status) ? row.status : "pending";
  return {
    id: typeof row?.id === "string" && row.id ? row.id : uid(),
    phone: String(row?.phone ?? ""),
    message: String(row?.message ?? ""),
    status,
    sentAt: String(row?.sentAt ?? ""),
    error: String(row?.error ?? ""),
  };
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatNumber(jid) {
  if (!jid) return "";
  return String(jid).split(":")[0].split("@")[0];
}

function getDelaySeconds() {
  const value = Number(els.delayInput.value);
  if (!Number.isFinite(value)) return 15;
  return Math.min(300, Math.max(0, Math.round(value)));
}

/* ---------- Toasts & dialogs ---------- */

function toast(message, kind = "info", timeout = 4200) {
  const item = document.createElement("div");
  item.className = `toast is-${kind}`;
  item.textContent = message;
  els.toastStack.appendChild(item);
  setTimeout(() => {
    item.classList.add("is-out");
    setTimeout(() => item.remove(), 200);
  }, timeout);
}

function confirmDialog({ title, message, confirmText = "Lanjutkan", danger = false }) {
  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalConfirm.textContent = confirmText;
  els.modalConfirm.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
  els.modal.classList.remove("is-hidden");
  setTimeout(() => els.modalConfirm.focus(), 30);

  return new Promise((resolve) => {
    state.modalResolve = resolve;
  });
}

function closeModal(result) {
  if (els.modal.classList.contains("is-hidden")) return;
  els.modal.classList.add("is-hidden");
  const resolve = state.modalResolve;
  state.modalResolve = null;
  if (resolve) resolve(result);
}

/* ---------- Activity log ---------- */

function addLog(kind, text) {
  const empty = els.logList.querySelector(".log-empty");
  if (empty) empty.remove();

  const item = document.createElement("div");
  item.className = `log-item is-${kind}`;

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const copy = document.createElement("span");
  copy.className = "log-text";
  copy.textContent = text;

  item.append(time, copy);
  els.logList.prepend(item);

  while (els.logList.children.length > 80) {
    els.logList.lastElementChild.remove();
  }
}

/* ---------- Persistence ---------- */

function persistNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  api.saveRows(state.rows).catch(() => {});
}

/* ---------- WhatsApp state ---------- */

function connectionMeta(connection) {
  switch (connection) {
    case "open":
      return {
        label: "Terhubung",
        chip: "is-on",
        dot: "is-on",
        tag: "Aktif",
        tagClass: "is-on",
        placeholder: "",
      };
    case "qr":
      return {
        label: "Scan QR",
        chip: "is-wait",
        dot: "is-wait",
        tag: "Scan QR",
        tagClass: "",
        placeholder: "Scan QR dengan WhatsApp",
      };
    case "connecting":
      return {
        label: "Menghubungkan...",
        chip: "is-wait",
        dot: "is-wait",
        tag: "Menghubungkan",
        tagClass: "",
        placeholder: "Menyiapkan koneksi WhatsApp...",
      };
    case "closed":
      return {
        label: "Terputus",
        chip: "is-off",
        dot: "is-off",
        tag: "Terputus",
        tagClass: "is-off",
        placeholder: "Koneksi terputus. Mencoba menghubungkan ulang...",
      };
    case "logged_out":
      return {
        label: "Sesi berakhir",
        chip: "is-off",
        dot: "is-off",
        tag: "Sesi berakhir",
        tagClass: "is-off",
        placeholder: "Klik Hubungkan lalu scan QR untuk masuk.",
      };
    case "error":
      return {
        label: "Error",
        chip: "is-off",
        dot: "is-off",
        tag: "Error",
        tagClass: "is-off",
        placeholder: "Terjadi kesalahan koneksi.",
      };
    default:
      return {
        label: "Tidak terhubung",
        chip: "",
        dot: "is-off",
        tag: "Menunggu",
        tagClass: "",
        placeholder: "Klik Hubungkan untuk menampilkan QR.",
      };
  }
}

function applyWAState(next) {
  const previousConnection = state.wa.connection;
  state.wa = { ...state.wa, ...next };
  const connection = state.wa.connection;
  const meta = connectionMeta(connection);
  const account = formatNumber(state.wa.me);

  els.connChip.className = `chip ${meta.chip}`.trim();
  els.connChipDot.className = `status-dot ${meta.dot}`;
  els.connChipText.textContent = meta.label;

  els.sideStatusDot.className = `status-dot ${meta.dot}`;
  els.sideStatusText.textContent = meta.label;
  els.sideStatusSub.textContent = account ? `+${account}` : "WhatsApp";
  els.navConnDot.className = `nav-dot ${meta.dot}`;

  els.connTag.className = `tag ${meta.tagClass}`.trim();
  els.connTag.textContent = meta.tag;

  els.connState.textContent = state.wa.message || meta.label;
  els.connAccount.textContent = account
    ? `Akun: +${account}`
    : connection === "qr"
      ? "Belum ada akun terhubung — scan QR di atas"
      : "Belum ada akun terhubung";

  const qr = state.wa.qr;
  if (connection === "open") {
    els.qrImage.classList.add("is-hidden");
    els.qrImage.removeAttribute("src");
    els.qrPlaceholder.classList.add("is-hidden");
    els.qrSuccess.classList.remove("is-hidden");
    els.qrSuccessText.textContent = account
      ? `Nomor +${account} siap mengirim pesan.`
      : "Siap mengirim pesan massal.";
  } else if (qr) {
    els.qrImage.src = qr;
    els.qrImage.classList.remove("is-hidden");
    els.qrPlaceholder.classList.add("is-hidden");
    els.qrSuccess.classList.add("is-hidden");
  } else {
    els.qrImage.classList.add("is-hidden");
    els.qrImage.removeAttribute("src");
    els.qrPlaceholder.classList.remove("is-hidden");
    els.qrSuccess.classList.add("is-hidden");
    els.qrSpinner.classList.toggle(
      "is-hidden",
      !(connection === "connecting" || connection === "closed"),
    );
    els.qrPlaceholderText.textContent = meta.placeholder;
  }

  els.btnConnect.disabled = ["connecting", "qr", "open"].includes(connection);
  els.btnLogout.disabled = !["open", "qr"].includes(connection);

  if (previousConnection !== connection) {
    if (connection === "open") {
      addLog("success", `Terhubung ke WhatsApp${account ? ` (+${account})` : ""}`);
      toast("WhatsApp berhasil terhubung", "success");
    } else if (connection === "qr") {
      addLog("info", "QR siap dipindai. Buka WhatsApp > Perangkat tertaut.");
    } else if (connection === "closed") {
      addLog("error", "Koneksi terputus. Mencoba menghubungkan ulang...");
    } else if (connection === "logged_out") {
      addLog("error", "Sesi WhatsApp berakhir. Scan QR untuk menghubungkan ulang.");
    } else if (connection === "error") {
      addLog("error", state.wa.message || "Terjadi kesalahan koneksi WhatsApp");
      toast(state.wa.message || "Terjadi kesalahan koneksi", "error");
    }
  }

  state.lastConnection = connection;
}

/* ---------- Stats ---------- */

function updateStats() {
  let pending = 0;
  let sent = 0;
  let failed = 0;

  for (const row of state.rows) {
    const hasContent = row.phone.trim() || row.message.trim();
    if (row.status === "sent") sent += 1;
    else if (row.status === "failed") failed += 1;
    else if (hasContent) pending += 1;
  }

  els.statPending.textContent = String(pending);
  els.statSent.textContent = String(sent);
  els.statFailed.textContent = String(failed);
  els.tableBadge.textContent = String(state.rows.length);
}

/* ---------- Grid rendering ---------- */

function statusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `badge badge-${status}`;
  badge.dataset.status = status;
  badge.textContent = STATUS_LABEL[status] || status;
  return badge;
}

function createCell(rowIndex, colIndex) {
  const col = COLS[colIndex];
  const row = state.rows[rowIndex];
  const cell = document.createElement("td");
  cell.dataset.row = String(rowIndex);
  cell.dataset.col = String(colIndex);
  cell.dataset.field = col.key;
  cell.className = `cell cell-${col.key}${col.editable ? " editable" : " readonly"}`;
  cell.tabIndex = -1;

  if (col.key === "status") cell.appendChild(statusBadge(row.status));
  else if (col.key === "sentAt") {
    cell.textContent = formatTime(row.sentAt);
    cell.title = row.sentAt || "";
  } else {
    cell.textContent = row[col.key] ?? "";
    if (col.key === "message" || col.key === "error") cell.title = row[col.key] || "";
  }

  return cell;
}

function iconButton(action, title, svgPath, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-btn${danger ? " is-danger" : ""}`;
  button.dataset.action = action;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none">${svgPath}</svg>`;
  return button;
}

const ICONS = {
  send: '<path d="M4.5 11.4 19 5.2c.6-.3 1.2.3.9.9l-6.2 14.5c-.3.6-1.2.6-1.4 0l-1.7-4.6-4.6-1.7c-.6-.2-.6-1.1 0-1.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  reset:
    '<path d="M5 8.5V5m0 3.5h3.5M5.6 8.4A7.2 7.2 0 1 1 4.8 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  delete:
    '<path d="M5.5 7.2h13M9.5 7.2V5.5c0-.6.4-1 1-1h3c.6 0 1 .4 1 1v1.7M7 7.2l.7 11c0 .7.6 1.3 1.3 1.3h6c.7 0 1.3-.6 1.3-1.3l.7-11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

function renderRow(row, rowIndex) {
  const tr = document.createElement("tr");
  tr.dataset.row = String(rowIndex);

  const indexCell = document.createElement("td");
  indexCell.className = "cell-index";
  indexCell.textContent = String(rowIndex + 1);
  indexCell.title = "Klik untuk memilih baris";
  tr.appendChild(indexCell);

  for (let colIndex = 0; colIndex < COLS.length; colIndex += 1) {
    tr.appendChild(createCell(rowIndex, colIndex));
  }

  const actions = document.createElement("td");
  actions.className = "cell-actions";
  const wrap = document.createElement("div");
  wrap.className = "row-actions";
  wrap.append(
    iconButton("send", "Kirim baris ini", ICONS.send),
    iconButton("reset", "Tandai pending", ICONS.reset),
    iconButton("delete", "Hapus baris", ICONS.delete, true),
  );
  actions.appendChild(wrap);
  tr.appendChild(actions);

  return tr;
}

function renderGrid({ focus = false } = {}) {
  const fragment = document.createDocumentFragment();
  state.rows.forEach((row, index) => fragment.appendChild(renderRow(row, index)));
  els.gridBody.replaceChildren(fragment);
  state.selectedCells = [];

  if (state.rows.length === 0) {
    state.active = null;
    state.anchor = null;
    state.selection = null;
  } else if (!state.active || state.active.row >= state.rows.length) {
    const rowIndex = state.active ? state.rows.length - 1 : 0;
    state.active = { row: rowIndex, col: 0 };
    state.anchor = { ...state.active };
    state.selection = { r1: rowIndex, c1: 0, r2: rowIndex, c2: 0 };
  }

  updateEmptyState();
  applySelection();
  updateStats();

  if (focus) focusActive();
}

function updateEmptyState() {
  els.emptyState.classList.toggle("is-hidden", state.rows.length > 0);
}

function getCell(rowIndex, colIndex) {
  return els.gridBody.querySelector(
    `tr[data-row="${rowIndex}"] td[data-col="${colIndex}"]`,
  );
}

function replaceRowDom(rowIndex) {
  const old = els.gridBody.querySelector(`tr[data-row="${rowIndex}"]`);
  const row = state.rows[rowIndex];
  if (!old || !row) return;
  old.replaceWith(renderRow(row, rowIndex));
  applySelection();
}

function updateRowVisual(rowIndex) {
  const row = state.rows[rowIndex];
  const tr = els.gridBody.querySelector(`tr[data-row="${rowIndex}"]`);
  if (!row || !tr) return;

  const statusCell = tr.querySelector('td[data-field="status"]');
  if (statusCell) statusCell.replaceChildren(statusBadge(row.status));

  const timeCell = tr.querySelector('td[data-field="sentAt"]');
  if (timeCell) {
    timeCell.textContent = formatTime(row.sentAt);
    timeCell.title = row.sentAt || "";
  }

  const errorCell = tr.querySelector('td[data-field="error"]');
  if (errorCell) {
    errorCell.textContent = row.error || "";
    errorCell.title = row.error || "";
  }
}

/* ---------- Selection ---------- */

function normalizeSelection(a, b) {
  return {
    r1: Math.min(a.row, b.row),
    r2: Math.max(a.row, b.row),
    c1: Math.min(a.col, b.col),
    c2: Math.max(a.col, b.col),
  };
}

function applySelection() {
  for (const cell of state.selectedCells) {
    cell.classList.remove("is-selected", "is-active");
  }
  state.selectedCells = [];

  const selection = state.selection;
  if (!selection) return;

  for (let row = selection.r1; row <= selection.r2; row += 1) {
    for (let col = selection.c1; col <= selection.c2; col += 1) {
      const cell = getCell(row, col);
      if (!cell) continue;
      cell.classList.add("is-selected");
      if (state.active && row === state.active.row && col === state.active.col) {
        cell.classList.add("is-active");
      }
      state.selectedCells.push(cell);
    }
  }
}

function focusActive() {
  if (!state.active) return;
  const cell = getCell(state.active.row, state.active.col);
  if (cell) cell.focus({ preventScroll: false });
}

function setActive(row, col, { extend = false } = {}) {
  if (state.rows.length === 0) return;
  const nextRow = Math.min(state.rows.length - 1, Math.max(0, row));
  const nextCol = Math.min(COLS.length - 1, Math.max(0, col));

  state.active = { row: nextRow, col: nextCol };

  if (!extend || !state.anchor) {
    state.anchor = { ...state.active };
    state.selection = { r1: nextRow, c1: nextCol, r2: nextRow, c2: nextCol };
  } else {
    state.selection = normalizeSelection(state.anchor, state.active);
  }

  applySelection();
  focusActive();
}

function moveActive(deltaRow, deltaCol, extend = false) {
  if (!state.active) return;
  setActive(state.active.row + deltaRow, state.active.col + deltaCol, { extend });
}

/* ---------- Editing ---------- */

function startEdit(initialText) {
  if (state.page !== "table" || !state.active) return;
  if (state.sending) {
    toast("Tunggu pengiriman selesai sebelum mengedit.", "info");
    return;
  }

  const col = COLS[state.active.col];
  if (!col.editable) {
    toast("Kolom status dan keterangan tidak dapat diedit.", "info");
    return;
  }

  const cell = getCell(state.active.row, state.active.col);
  if (!cell) return;

  if (state.editor) commitEditor();

  const row = state.rows[state.active.row];
  const previousValue = row[col.key] ?? "";

  const textarea = document.createElement("textarea");
  textarea.className = `cell-editor${col.key === "message" ? " is-long" : ""}`;
  textarea.value = initialText !== undefined ? initialText : previousValue;
  textarea.spellcheck = false;

  cell.classList.add("is-editing");
  cell.replaceChildren(textarea);

  state.editor = {
    row: state.active.row,
    col: state.active.col,
    textarea,
    previousValue,
  };

  textarea.addEventListener("keydown", onEditorKeydown);
  textarea.addEventListener("blur", () => {
    if (state.editor && state.editor.textarea === textarea) commitEditor();
  });

  textarea.focus();
  if (initialText === undefined) textarea.select();
  else {
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }
}

function onEditorKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelEditor();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    commitEditor("down");
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    commitEditor(event.shiftKey ? "left" : "right");
    return;
  }

  event.stopPropagation();
}

function commitEditor(move) {
  const editor = state.editor;
  if (!editor) return;
  state.editor = null;

  const row = state.rows[editor.row];
  if (!row) {
    renderGrid();
    return;
  }

  const field = COLS[editor.col].key;
  const value = editor.textarea.value;
  const changed = value !== row[field];

  row[field] = value;

  if (changed) {
    if (row.status === "sent" || row.status === "failed" || row.status === "sending") {
      row.status = "pending";
      row.sentAt = "";
      row.error = "";
    }
    persistNow();
  }

  replaceRowDom(editor.row);
  updateStats();

  if (move === "down") {
    setActive(editor.row + 1, editor.col);
  } else if (move === "right") {
    setActive(editor.row, editor.col + 1);
  } else if (move === "left") {
    setActive(editor.row, editor.col - 1);
  } else {
    state.active = { row: editor.row, col: editor.col };
    state.anchor = { ...state.active };
    state.selection = { r1: editor.row, c1: editor.col, r2: editor.row, c2: editor.col };
    applySelection();
    focusActive();
  }
}

function cancelEditor() {
  const editor = state.editor;
  if (!editor) return;
  state.editor = null;
  replaceRowDom(editor.row);
  state.active = { row: editor.row, col: editor.col };
  state.anchor = { ...state.active };
  state.selection = {
    r1: editor.row,
    c1: editor.col,
    r2: editor.row,
    c2: editor.col,
  };
  applySelection();
  focusActive();
}

/* ---------- Clipboard ---------- */

function getSelectionRect() {
  if (state.selection) return state.selection;
  if (state.active) {
    return {
      r1: state.active.row,
      c1: state.active.col,
      r2: state.active.row,
      c2: state.active.col,
    };
  }
  return null;
}

function copySelection(cut = false) {
  const rect = getSelectionRect();
  if (!rect) return;

  const lines = [];
  for (let rowIndex = rect.r1; rowIndex <= rect.r2; rowIndex += 1) {
    const row = state.rows[rowIndex];
    const values = [];
    for (let colIndex = rect.c1; colIndex <= rect.c2; colIndex += 1) {
      values.push(row ? String(row[COLS[colIndex].key] ?? "") : "");
    }
    lines.push(values.join("\t"));
  }

  api.copyText(lines.join("\n"));
  const cellCount = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
  toast(`${cellCount} sel ${cut ? "dipotong" : "disalin"} ke clipboard`, "info", 2200);

  if (cut) {
    clearCells(rect);
  }
}

function clearCells(rect) {
  let changed = 0;
  const touchedRows = new Set();

  for (let rowIndex = rect.r1; rowIndex <= rect.r2; rowIndex += 1) {
    const row = state.rows[rowIndex];
    if (!row) continue;
    for (let colIndex = rect.c1; colIndex <= rect.c2; colIndex += 1) {
      const col = COLS[colIndex];
      if (!col.editable) continue;
      if (row[col.key] !== "") {
        row[col.key] = "";
        changed += 1;
        touchedRows.add(rowIndex);
      }
    }
  }

  if (!changed) return;

  for (const rowIndex of touchedRows) {
    const row = state.rows[rowIndex];
    if (row.status !== "pending") {
      row.status = "pending";
      row.sentAt = "";
      row.error = "";
    }
  }

  renderGrid();
  persistNow();
  toast(`${changed} sel dihapus`, "info", 1800);
}

function parseClipboardText(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

function handlePaste(event) {
  if (!els.modal.classList.contains("is-hidden")) return;
  if (state.page !== "table" || state.editor) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
  if (!state.active) return;

  if (state.sending) {
    event.preventDefault();
    toast("Tunggu pengiriman selesai sebelum menempel data.", "info");
    return;
  }

  if (!COLS[state.active.col].editable) {
    event.preventDefault();
    toast("Pilih sel WA Number atau WA Message terlebih dahulu.", "info");
    return;
  }

  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();

  const matrix = parseClipboardText(text);
  if (!matrix.length) return;

  const start = { ...state.active };
  const requiredRows = start.row + matrix.length;
  while (state.rows.length < requiredRows) state.rows.push(newRow());

  let lastRow = start.row;
  let maxWidth = 1;

  matrix.forEach((columns, offset) => {
    const row = state.rows[start.row + offset];
    let touched = false;

    columns.forEach((value, columnOffset) => {
      const colIndex = start.col + columnOffset;
      if (colIndex >= COLS.length) return;
      if (!COLS[colIndex].editable) return;
      const key = COLS[colIndex].key;
      if (row[key] !== value) {
        row[key] = value;
        touched = true;
      }
      maxWidth = Math.max(maxWidth, columnOffset + 1);
    });

    if (touched && row.status !== "pending") {
      row.status = "pending";
      row.sentAt = "";
      row.error = "";
    }

    lastRow = start.row + offset;
  });

  renderGrid();
  state.anchor = { ...start };
  state.active = { ...start };
  state.selection = {
    r1: start.row,
    c1: start.col,
    r2: lastRow,
    c2: Math.min(start.col + maxWidth - 1, COLS.length - 1),
  };
  applySelection();
  focusActive();
  updateStats();
  persistNow();

  toast(`${matrix.length} baris ditempel dari clipboard`, "success", 2200);
}

/* ---------- Sending ---------- */

function setSendUi(active, total = 0) {
  els.btnSend.disabled = active;
  els.btnStop.classList.toggle("is-hidden", !active);
  els.btnStop.disabled = false;
  els.btnStop.textContent = "Hentikan";
  els.sendProgress.classList.toggle("is-hidden", !active);
  els.btnAddRow.disabled = active;
  els.btnDeleteRows.disabled = active;
  els.btnImport.disabled = active;
  els.btnExport.disabled = active;
  els.delayInput.disabled = active;
  els.skipSent.disabled = active;

  if (active) updateProgress(0, total);
}

function updateProgress(done, total) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  els.sendProgressBar.style.width = `${percent}%`;
  els.sendProgressText.textContent = `${done} / ${total}`;
}

async function runSend(targets) {
  if (!targets.length) return;

  state.sending = true;
  state.stopRequested = false;
  setSendUi(true, targets.length);

  const delayMs = getDelaySeconds() * 1000;
  let success = 0;
  let failed = 0;
  let stopped = false;

  for (let index = 0; index < targets.length; index += 1) {
    if (state.stopRequested) {
      stopped = true;
      break;
    }

    if (state.wa.connection !== "open") {
      addLog("error", "WhatsApp terputus. Pengiriman dihentikan.");
      toast("WhatsApp terputus. Pengiriman dihentikan.", "error");
      stopped = true;
      break;
    }

    const row = targets[index];
    const rowIndex = state.rows.indexOf(row);
    if (rowIndex === -1) continue;

    row.status = "sending";
    row.error = "";
    updateRowVisual(rowIndex);
    updateStats();
    updateProgress(index, targets.length);

    let result;
    try {
      result = await api.send({ phone: row.phone, message: row.message });
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }

    if (result?.ok) {
      row.status = "sent";
      row.sentAt = new Date().toISOString();
      row.error = "";
      success += 1;
      addLog("success", `${row.phone} — terkirim`);
    } else {
      row.status = "failed";
      row.error = result?.error || "Gagal mengirim pesan";
      failed += 1;
      addLog("error", `${row.phone} — ${row.error}`);
    }

    updateRowVisual(rowIndex);
    updateStats();
    updateProgress(index + 1, targets.length);
    persistNow();

    if (index < targets.length - 1 && !state.stopRequested && delayMs > 0) {
      await sleepChunk(delayMs);
    }
  }

  state.sending = false;
  state.stopRequested = false;
  setSendUi(false);
  persistNow();

  if (stopped) {
    toast(`Pengiriman dihentikan. ${success} terkirim, ${failed} gagal.`, "info", 6000);
    addLog("info", `Pengiriman dihentikan. ${success} terkirim, ${failed} gagal.`);
  } else {
    const kind = failed > 0 ? "error" : "success";
    toast(`Selesai. ${success} terkirim, ${failed} gagal.`, kind, 6000);
    addLog(kind, `Selesai. ${success} terkirim, ${failed} gagal.`);
  }
}

async function startBulkSend() {
  if (state.sending) return;

  if (state.wa.connection !== "open") {
    toast("Hubungkan WhatsApp terlebih dahulu.", "error");
    setPage("whatsapp");
    return;
  }

  const skipSent = els.skipSent.checked;
  const targets = state.rows.filter(
    (row) => row.phone.trim() && row.message.trim() && (!skipSent || row.status !== "sent"),
  );

  if (!targets.length) {
    toast(
      skipSent
        ? "Tidak ada pesan yang perlu dikirim. Semua baris valid sudah terkirim."
        : "Tidak ada baris valid. Isi WA Number dan WA Message terlebih dahulu.",
      "info",
    );
    return;
  }

  const delay = getDelaySeconds();
  const ok = await confirmDialog({
    title: "Kirim pesan massal?",
    message: `${targets.length} pesan akan dikirim satu per satu dengan jeda ${delay} detik.\n\nPastikan nomor dan isi pesan sudah benar.`,
    confirmText: `Kirim ${targets.length} pesan`,
  });

  if (!ok) return;
  await runSend(targets);
}

async function sendSingle(rowIndex) {
  if (state.sending) return;

  if (state.wa.connection !== "open") {
    toast("Hubungkan WhatsApp terlebih dahulu.", "error");
    setPage("whatsapp");
    return;
  }

  const row = state.rows[rowIndex];
  if (!row) return;

  if (!row.phone.trim() || !row.message.trim()) {
    toast("Lengkapi WA Number dan WA Message terlebih dahulu.", "info");
    return;
  }

  await runSend([row]);
}

/* ---------- Row operations ---------- */

function addRows(count = 1) {
  if (state.sending) return;

  const startIndex = state.rows.length;
  for (let index = 0; index < count; index += 1) {
    state.rows.push(newRow());
  }

  renderGrid();
  setActive(startIndex, 0);
  persistNow();
}

async function deleteRowsAt(rowIndex, count = 1) {
  if (state.sending) {
    toast("Tunggu pengiriman selesai sebelum menghapus data.", "info");
    return;
  }

  const ok = await confirmDialog({
    title: count > 1 ? "Hapus baris terpilih?" : "Hapus baris?",
    message:
      count > 1
        ? `${count} baris akan dihapus. Tindakan ini tidak dapat dibatalkan.`
        : `Baris ${rowIndex + 1} akan dihapus. Tindakan ini tidak dapat dibatalkan.`,
    confirmText: "Hapus",
    danger: true,
  });

  if (!ok) return;

  state.rows.splice(rowIndex, count);
  state.active = null;
  state.anchor = null;
  state.selection = null;
  renderGrid();
  if (state.rows.length) setActive(Math.min(rowIndex, state.rows.length - 1), 0);
  persistNow();
  toast(`${count} baris dihapus`, "info", 2000);
}

function resetRowStatus(rowIndex) {
  if (state.sending) {
    toast("Tunggu pengiriman selesai.", "info");
    return;
  }

  const row = state.rows[rowIndex];
  if (!row) return;

  row.status = "pending";
  row.sentAt = "";
  row.error = "";
  updateRowVisual(rowIndex);
  updateStats();
  persistNow();
  toast(`Status baris ${rowIndex + 1} direset ke pending`, "info", 2000);
}

/* ---------- Import / export ---------- */

async function importExcel() {
  if (state.sending) return;

  const result = await api.importRows();
  if (result?.canceled) return;

  if (result?.error) {
    toast(result.error, "error", 6000);
    return;
  }

  const imported = (result?.rows || []).map(normalizeRow);
  if (!imported.length) {
    toast("Tidak ada data valid ditemukan di file Excel.", "info");
    return;
  }

  const hasData = state.rows.some((row) => row.phone.trim() || row.message.trim());
  if (hasData) {
    const ok = await confirmDialog({
      title: "Import data Excel",
      message: `${imported.length} baris ditemukan di "${result.fileName}" (sheet ${result.sheet}).\n\nGanti seluruh data tabel saat ini?`,
      confirmText: "Import",
    });
    if (!ok) return;
  }

  state.rows = imported;
  state.active = { row: 0, col: 0 };
  state.anchor = { row: 0, col: 0 };
  state.selection = { r1: 0, c1: 0, r2: 0, c2: 0 };
  renderGrid({ focus: true });
  persistNow();
  setPage("table");
  toast(`${imported.length} baris berhasil diimport`, "success");

  if (result.truncated) {
    toast("File berisi lebih dari 10.000 baris. Hanya 10.000 baris pertama yang diimport.", "info", 7000);
  }
}

async function exportExcel() {
  if (state.sending) {
    toast("Tunggu pengiriman selesai sebelum export.", "info");
    return;
  }

  if (!state.rows.length) {
    toast("Belum ada data untuk diexport.", "info");
    return;
  }

  const result = await api.exportRows(state.rows);
  if (result?.canceled) return;

  if (result?.error) {
    toast(result.error, "error", 6000);
    return;
  }

  const fileName = String(result.filePath || "").split(/[\\/]/).pop();
  toast(`Data diexport ke ${fileName}`, "success", 5000);
}

/* ---------- Page navigation ---------- */

function setPage(page) {
  state.page = page;

  els.navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.page === page);
  });

  const isWhatsapp = page === "whatsapp";
  els.pageWhatsapp.classList.toggle("is-hidden", !isWhatsapp);
  els.pageTable.classList.toggle("is-hidden", isWhatsapp);

  els.pageTitle.textContent = isWhatsapp ? "WhatsApp" : "Tabel Pesan";
  els.pageSubtitle.textContent = isWhatsapp
    ? "Hubungkan akun dan pantau hasil pengiriman pesan."
    : "Edit data seperti spreadsheet lalu kirim massal.";

  if (!isWhatsapp) {
    updateStats();
    updateEmptyState();
    requestAnimationFrame(() => {
      if (state.active) focusActive();
    });
  }
}

/* ---------- Events ---------- */

function bindEvents() {
  els.navItems.forEach((item) => {
    item.addEventListener("click", () => setPage(item.dataset.page));
  });

  els.btnConnect.addEventListener("click", async () => {
    try {
      const result = await api.connect();
      if (result) applyWAState(result);
    } catch (error) {
      toast(error?.message || "Gagal menghubungkan WhatsApp", "error");
    }
  });

  els.btnLogout.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Putuskan WhatsApp?",
      message:
        "Koneksi akan diputuskan dan sesi dihapus. Anda perlu scan QR kembali untuk menghubungkan akun.",
      confirmText: "Putuskan",
      danger: true,
    });
    if (!ok) return;

    try {
      const result = await api.logout();
      if (result) applyWAState(result);
      addLog("info", "Sesi WhatsApp diputuskan");
    } catch (error) {
      toast(error?.message || "Gagal memutuskan koneksi", "error");
    }
  });

  els.btnReset.addEventListener("click", async () => {
    if (state.sending) {
      toast("Tunggu pengiriman selesai sebelum reset sesi.", "info");
      return;
    }

    const ok = await confirmDialog({
      title: "Reset sesi WhatsApp?",
      message:
        "Sesi saat ini akan dihapus dan QR baru akan ditampilkan. Gunakan ini jika QR tidak muncul atau ingin berganti akun.",
      confirmText: "Reset Sesi",
      danger: true,
    });
    if (!ok) return;

    try {
      const result = await api.reset();
      if (result) applyWAState(result);
      addLog("info", "Sesi direset. Menunggu QR baru.");
    } catch (error) {
      toast(error?.message || "Gagal reset sesi", "error");
    }
  });

  els.btnClearLog.addEventListener("click", () => {
    els.logList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "Belum ada aktivitas.";
    els.logList.appendChild(empty);
  });

  els.btnSend.addEventListener("click", startBulkSend);

  els.btnStop.addEventListener("click", () => {
    if (!state.sending) return;
    state.stopRequested = true;
    els.btnStop.disabled = true;
    els.btnStop.textContent = "Menghentikan...";
    addLog("info", "Permintaan berhenti diterima. Menyelesaikan pesan yang sedang dikirim...");
  });

  els.btnAddRow.addEventListener("click", () => addRows(1));
  els.btnEmptyAdd.addEventListener("click", () => addRows(1));

  els.btnDeleteRows.addEventListener("click", () => {
    if (!state.rows.length) return;
    const rect = getSelectionRect();
    if (!rect) return;
    deleteRowsAt(rect.r1, rect.r2 - rect.r1 + 1);
  });

  els.btnImport.addEventListener("click", importExcel);
  els.btnEmptyImport.addEventListener("click", importExcel);
  els.btnExport.addEventListener("click", exportExcel);

  els.gridBody.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".row-actions")) return;
    if (event.target.closest("textarea")) return;
    if (state.editor) commitEditor();

    const indexCell = event.target.closest("td.cell-index");
    if (indexCell) {
      event.preventDefault();
      const rowIndex = Number(indexCell.parentElement.dataset.row);

      if (event.shiftKey && state.anchor) {
        state.active = { row: rowIndex, col: COLS.length - 1 };
        state.selection = normalizeSelection(state.anchor, state.active);
        applySelection();
        getCell(rowIndex, 0)?.focus();
        return;
      }

      state.anchor = { row: rowIndex, col: 0 };
      state.active = { row: rowIndex, col: COLS.length - 1 };
      state.selection = { r1: rowIndex, c1: 0, r2: rowIndex, c2: COLS.length - 1 };
      applySelection();
      getCell(rowIndex, 0)?.focus();
      return;
    }

    const cell = event.target.closest("td[data-col]");
    if (!cell) return;

    event.preventDefault();
    const rowIndex = Number(cell.dataset.row);
    const colIndex = Number(cell.dataset.col);

    if (event.shiftKey && state.anchor) {
      state.active = { row: rowIndex, col: colIndex };
      state.selection = normalizeSelection(state.anchor, state.active);
      applySelection();
      getCell(rowIndex, colIndex)?.focus();
    } else {
      setActive(rowIndex, colIndex);
    }
  });

  els.gridBody.addEventListener("dblclick", (event) => {
    const cell = event.target.closest("td[data-col]");
    if (!cell) return;
    const colIndex = Number(cell.dataset.col);
    if (!COLS[colIndex].editable) return;
    startEdit();
  });

  els.gridBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const rowIndex = Number(button.closest("tr").dataset.row);
    if (!Number.isInteger(rowIndex)) return;

    const action = button.dataset.action;
    if (action === "delete") deleteRowsAt(rowIndex, 1);
    else if (action === "reset") resetRowStatus(rowIndex);
    else if (action === "send") sendSingle(rowIndex);
  });

  document.addEventListener("keydown", (event) => {
    if (!els.modal.classList.contains("is-hidden")) return;
    if (state.page !== "table" || state.editor) return;
    if (!state.active) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, button")) {
      return;
    }

    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection(false);
      return;
    }

    if (mod && event.key.toLowerCase() === "x") {
      event.preventDefault();
      copySelection(true);
      return;
    }

    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      if (!state.rows.length) return;
      state.anchor = { row: 0, col: 0 };
      state.active = { row: state.rows.length - 1, col: COLS.length - 1 };
      state.selection = {
        r1: 0,
        c1: 0,
        r2: state.rows.length - 1,
        c2: COLS.length - 1,
      };
      applySelection();
      focusActive();
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1, 0, event.shiftKey);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveActive(1, 0, event.shiftKey);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveActive(0, -1, event.shiftKey);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveActive(0, 1, event.shiftKey);
        return;
      case "Home":
        event.preventDefault();
        setActive(state.active.row, 0, { extend: event.shiftKey });
        return;
      case "End":
        event.preventDefault();
        setActive(state.active.row, COLS.length - 1, { extend: event.shiftKey });
        return;
      case "Tab":
        event.preventDefault();
        if (event.shiftKey) {
          if (state.active.col > 0) setActive(state.active.row, state.active.col - 1);
          else if (state.active.row > 0) setActive(state.active.row - 1, COLS.length - 1);
        } else if (state.active.col < COLS.length - 1) {
          setActive(state.active.row, state.active.col + 1);
        } else {
          setActive(state.active.row + 1, 0);
        }
        return;
      case "Enter":
        event.preventDefault();
        moveActive(1, 0);
        return;
      case "F2":
        event.preventDefault();
        startEdit();
        return;
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        const rect = getSelectionRect();
        if (rect) clearCells(rect);
        return;
      }
      case "Escape":
        if (state.selection) {
          state.selection = {
            r1: state.active.row,
            c1: state.active.col,
            r2: state.active.row,
            c2: state.active.col,
          };
          state.anchor = { ...state.active };
          applySelection();
        }
        return;
      default:
        break;
    }

    if (!mod && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      startEdit(event.key);
    }
  });

  document.addEventListener("paste", handlePaste);

  els.modalCancel.addEventListener("click", () => closeModal(false));
  els.modalConfirm.addEventListener("click", () => closeModal(true));
  els.modal.addEventListener("mousedown", (event) => {
    if (event.target === els.modal) closeModal(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.modal.classList.contains("is-hidden")) {
      closeModal(false);
    }
  });

  window.addEventListener("pagehide", () => {
    if (state.editor) commitEditor();
    if (state.rows.length) api.saveRows(state.rows).catch(() => {});
  });
}

/* ---------- Init ---------- */

async function init() {
  bindEvents();
  setPage("whatsapp");

  api.onWAEvent((event) => {
    if (event?.type === "state") applyWAState(event);
  });

  try {
    const status = await api.status();
    if (status) applyWAState(status);
  } catch {
    // ignore
  }

  try {
    const loaded = await api.loadRows();
    const rows = Array.isArray(loaded?.rows) ? loaded.rows.map(normalizeRow) : [];
    state.rows = rows.length ? rows : Array.from({ length: DEFAULT_ROWS }, () => newRow());
  } catch {
    state.rows = Array.from({ length: DEFAULT_ROWS }, () => newRow());
  }

  renderGrid();
  updateStats();
  addLog("info", "Aplikasi siap digunakan");
}

init();
