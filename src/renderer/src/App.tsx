import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  Check,
  FileDown,
  FileSpreadsheet,
  FileUp,
  MessageCircle,
  Plus,
  Pencil,
  RefreshCw,
  Send,
  Table2,
  Trash2,
  Unlink,
  Wifi,
  X,
} from "lucide-react";
import type {
  ContactRow,
  ImportResult,
  MessageDataset,
  RowStatus,
  WhatsAppState,
} from "../../shared/contracts.js";
import { Badge } from "@/components/ui/badge.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Progress } from "@/components/ui/progress.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";

type Page = "whatsapp" | "datasets" | "table";
type ToastKind = "info" | "success" | "error";
type Cell = { row: number; col: number };
type Selection = { r1: number; c1: number; r2: number; c2: number };
type ResizeDrag =
  | { kind: "column"; index: number; start: number; size: number }
  | { kind: "row"; rowId: string; start: number; size: number };
type Dialog = {
  kind: "confirm" | "input" | "sheet";
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  value?: string;
  error?: string;
  sheetNames?: string[];
};
type ToastItem = { id: number; message: string; kind: ToastKind };
type LogItem = { id: number; time: string; message: string; kind: ToastKind };
type DatasetContextMenu = { datasetId: string; x: number; y: number };
type MessageDataMenu = {
  rowId: string;
  x: number;
  y: number;
  target: "cell" | "editor";
  selectionStart?: number;
  selectionEnd?: number;
};

const MAX_ROWS = 10_000;
const columns = ["WA Number", "WA Message", "Status", "Terkirim Pada", "Keterangan"];
const initialColumnWidths = [48, 250, 380, 132, 164, 240, 136];
const connectionLabels: Record<WhatsAppState["connection"], string> = {
  idle: "Tidak terhubung",
  connecting: "Menghubungkan...",
  qr: "Scan QR",
  open: "Terhubung",
  closed: "Terputus",
  logged_out: "Sesi berakhir",
  error: "Error",
};
const statusLabels: Record<RowStatus, string> = {
  pending: "Pending",
  sending: "Mengirim",
  sent: "Terkirim",
  failed: "Gagal",
};

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${Math.random()}`;
}

function newRow(): ContactRow {
  return { id: uid(), phone: "", message: "", status: "pending", sentAt: "", error: "" };
}

function normalizeRow(row: Partial<ContactRow>): ContactRow {
  const validStatus: RowStatus[] = ["pending", "sent", "failed"];
  return {
    id: typeof row.id === "string" && row.id ? row.id : uid(),
    phone: String(row.phone ?? ""),
    message: String(row.message ?? ""),
    status: validStatus.includes(row.status as RowStatus) ? (row.status as RowStatus) : "pending",
    sentAt: String(row.sentAt ?? ""),
    error: String(row.error ?? ""),
    sourceData:
      row.sourceData && typeof row.sourceData === "object" && !Array.isArray(row.sourceData)
        ? Object.fromEntries(
            Object.entries(row.sourceData).map(([key, value]) => [key, String(value ?? "")]),
          )
        : {},
  };
}

function resolveMessageTemplate(message: string, sourceData?: Record<string, string>) {
  return message.replace(/\{\{([^{}]+)\}\}/g, (placeholder, rawKey: string) => {
    const key = rawKey.trim();
    const value = sourceData?.[key];
    return value === undefined ? placeholder : value;
  });
}

function formatTime(value: string) {
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

function formatNumber(jid: string | null) {
  return jid ? jid.split(":")[0].split("@")[0] : "";
}

function validateSheetName(value: string) {
  const name = value.trim();
  if (!name) return "Nama sheet tidak boleh kosong.";
  if (name.length > 31) return "Nama sheet maksimal 31 karakter.";
  if (/[\u0000-\u001f\\/?*[\]:]/.test(name)) {
    return "Nama sheet tidak boleh mengandung karakter: \\ / ? * [ ] :";
  }
  if (name.startsWith("'") || name.endsWith("'")) {
    return "Nama sheet tidak boleh diawali atau diakhiri tanda petik satu.";
  }
  return "";
}

function connectionCopy(connection: WhatsAppState["connection"]) {
  switch (connection) {
    case "qr":
      return "Scan QR dengan WhatsApp di ponsel Anda.";
    case "connecting":
      return "Menyiapkan koneksi WhatsApp...";
    case "closed":
      return "Koneksi terputus. Mencoba menghubungkan ulang...";
    case "logged_out":
      return "Klik Hubungkan untuk menampilkan QR baru.";
    case "error":
      return "Terjadi kesalahan koneksi.";
    default:
      return "Klik Hubungkan untuk menampilkan QR.";
  }
}

function statusStyle(status: RowStatus) {
  switch (status) {
    case "sent":
      return "success" as const;
    case "failed":
      return "destructive" as const;
    case "sending":
      return "warning" as const;
    default:
      return "muted" as const;
  }
}

function datasetCounts(rows: ContactRow[]) {
  return rows.reduce(
    (counts, row) => {
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "sent") counts.sent += 1;
      if (row.status === "failed") counts.failed += 1;
      return counts;
    },
    { pending: 0, sent: 0, failed: 0 },
  );
}

function rectBetween(a: Cell, b: Cell): Selection {
  return {
    r1: Math.min(a.row, b.row),
    c1: Math.min(a.col, b.col),
    r2: Math.max(a.row, b.row),
    c2: Math.max(a.col, b.col),
  };
}

function isSelected(selection: Selection | null, row: number, col: number) {
  return Boolean(
    selection &&
      row >= selection.r1 &&
      row <= selection.r2 &&
      col >= selection.c1 &&
      col <= selection.c2,
  );
}

export function App() {
  const [page, setPage] = useState<Page>("whatsapp");
  const [datasets, setDatasets] = useState<MessageDataset[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [datasetsLoaded, setDatasetsLoaded] = useState(false);
  const [wa, setWa] = useState<WhatsAppState>({
    connection: "idle",
    qr: null,
    me: null,
    message: "",
  });
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [datasetContextMenu, setDatasetContextMenu] = useState<DatasetContextMenu | null>(null);
  const [messageDataMenu, setMessageDataMenu] = useState<MessageDataMenu | null>(null);
  const [messageEditor, setMessageEditor] = useState<{
    rowId: string;
    rowNumber: number;
    value: string;
  } | null>(null);
  const [active, setActive] = useState<Cell | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [checkedRowIds, setCheckedRowIds] = useState<Set<string>>(() => new Set());
  const [columnWidths, setColumnWidths] = useState(initialColumnWidths);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [isResizing, setIsResizing] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [delay, setDelay] = useState(15);
  const [skipSent, setSkipSent] = useState(true);
  const [clipboardText, setClipboardText] = useState("");
  const stopRequested = useRef(false);
  const waRef = useRef(wa);
  const dialogResolver = useRef<((value: boolean | string | null) => void) | null>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const activeRef = useRef<Cell | null>(active);
  const anchorRef = useRef<Cell | null>(anchor);
  const selectionRef = useRef<Selection | null>(selection);
  const selectionModeRef = useRef<"cell" | "row" | "column">("cell");
  const dragSelectionRef = useRef<{ anchor: Cell; pointerId: number } | null>(null);
  const suppressGridClickRef = useRef(false);
  const resizeDrag = useRef<ResizeDrag | null>(null);
  const lastConnection = useRef(wa.connection);

  waRef.current = wa;
  activeRef.current = active;
  anchorRef.current = anchor;
  selectionRef.current = selection;

  const toast = useCallback((message: string, kind: ToastKind = "info", timeout = 4200) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      timeout,
    );
  }, []);

  const addLog = useCallback((message: string, kind: ToastKind = "info") => {
    const item = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
      message,
      kind,
    };
    setLogs((current) => [item, ...current].slice(0, 80));
  }, []);

  const confirm = useCallback(
    (options: Omit<Dialog, "kind">) =>
      new Promise<boolean>((resolve) => {
        dialogResolver.current = (value) => resolve(value === true);
        setDialog({ ...options, kind: "confirm" });
      }),
    [],
  );

  const askForSheet = useCallback(
    (sheetNames: string[]) =>
      new Promise<string | null>((resolve) => {
        dialogResolver.current = (value) => resolve(typeof value === "string" ? value : null);
        setDialog({
          kind: "sheet",
          title: "Pilih sheet Excel",
          message: "Pilih sheet yang berisi data untuk diimport.",
          confirmText: "Import Sheet",
          value: sheetNames.includes("WHATSAPPS") ? "WHATSAPPS" : sheetNames[0],
          sheetNames,
        });
      }),
    [],
  );

  const askForInput = useCallback(
    (options: Omit<Dialog, "kind">) =>
      new Promise<string | null>((resolve) => {
        dialogResolver.current = (value) => resolve(typeof value === "string" ? value : null);
        setDialog({ ...options, kind: "input" });
      }),
    [],
  );

  const settleDialog = useCallback((value: boolean | string | null) => {
    setDialog(null);
    const resolve = dialogResolver.current;
    dialogResolver.current = null;
    resolve?.(value);
  }, []);

  const activeDataset = datasets.find((dataset) => dataset.id === activeDatasetId) ?? null;
  const rows = activeDataset?.rows ?? [];

  const updateRows = useCallback((updater: (current: ContactRow[]) => ContactRow[]) => {
    if (!activeDatasetId) return;
    setDatasets((current) =>
      current.map((dataset) =>
        dataset.id === activeDatasetId ? { ...dataset, rows: updater(dataset.rows) } : dataset,
      ),
    );
  }, [activeDatasetId]);

  const openDataset = useCallback((datasetId: string) => {
    setActiveDatasetId(datasetId);
    setMessageDataMenu(null);
    setCheckedRowIds(new Set());
    setActive(null);
    setAnchor(null);
    setSelection(null);
    setRowHeights({});
    setPage("table");
  }, []);

  const disconnectDataset = useCallback(async (dataset: MessageDataset) => {
    setDatasetContextMenu(null);
    const confirmed = await confirm({
      title: "Putuskan koneksi ke Excel?",
      message: `Apakah kamu yakin ingin menghapus "${dataset.name}" dari daftar? Data yang diimport akan dihapus dari aplikasi.`,
      confirmText: "Putuskan",
      danger: true,
    });
    if (!confirmed) return;

    setDatasets((current) => current.filter((item) => item.id !== dataset.id));
    if (activeDatasetId === dataset.id) {
      const nextDataset = datasets.find((item) => item.id !== dataset.id);
      setActiveDatasetId(nextDataset?.id ?? null);
      setPage("datasets");
      setCheckedRowIds(new Set());
      setActive(null);
      setAnchor(null);
      setSelection(null);
      setRowHeights({});
    }
    toast(`"${dataset.name}" telah dihapus dari daftar.`, "success");
  }, [activeDatasetId, confirm, datasets, toast]);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.bulkWA.onWAEvent((event) => {
      if (mounted) setWa(event);
    });

    void window.bulkWA
      .status()
      .then((status) => {
        if (mounted) setWa(status);
      })
      .catch((error: unknown) => {
        if (mounted) toast(`Gagal memuat status WhatsApp: ${errorMessage(error)}`, "error");
      });

    void window.bulkWA
      .loadDatasets()
      .then((result) => {
        if (!mounted) return;
        const loadedDatasets = Array.isArray(result?.datasets)
          ? result.datasets.map((dataset) => ({
              ...dataset,
              rows: Array.isArray(dataset.rows) ? dataset.rows.map(normalizeRow) : [],
            }))
          : [];
        setDatasets(loadedDatasets);
        setActiveDatasetId(loadedDatasets[0]?.id ?? null);
        setDatasetsLoaded(true);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        toast(`Gagal memuat dataset: ${errorMessage(error)}`, "error");
        setDatasetsLoaded(true);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [toast]);

  useEffect(() => {
    if (!datasetsLoaded) return;
    const timer = window.setTimeout(() => {
      void window.bulkWA
        .saveDatasets(datasets)
        .then((result) => {
          if (!result?.ok) toast(result?.error || "Gagal menyimpan dataset.", "error");
        })
        .catch((error: unknown) => toast(`Gagal menyimpan dataset: ${errorMessage(error)}`, "error"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [datasets, datasetsLoaded, toast]);

  useEffect(() => {
    if (lastConnection.current === wa.connection) return;
    lastConnection.current = wa.connection;
    const account = formatNumber(wa.me);
    switch (wa.connection) {
      case "open":
        addLog(`Terhubung ke WhatsApp${account ? ` (+${account})` : ""}`, "success");
        toast("WhatsApp berhasil terhubung", "success");
        break;
      case "qr":
        addLog("QR siap dipindai. Buka WhatsApp > Perangkat tertaut.");
        break;
      case "closed":
        addLog("Koneksi terputus. Mencoba menghubungkan ulang...", "error");
        break;
      case "logged_out":
        addLog("Sesi WhatsApp berakhir. Scan QR untuk menghubungkan ulang.", "error");
        break;
      case "error":
        addLog(wa.message || "Terjadi kesalahan koneksi WhatsApp", "error");
        toast(wa.message || "Terjadi kesalahan koneksi", "error");
        break;
    }
  }, [wa.connection, wa.me, wa.message, addLog, toast]);

  useEffect(() => {
    addLog("Aplikasi siap digunakan");
  }, [addLog]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = resizeDrag.current;
      if (!drag) return;
      const delta = event.clientX - drag.start;
      if (drag.kind === "column") {
        const minimum = drag.index === 0 ? 40 : 80;
        const width = Math.min(800, Math.max(minimum, drag.size + delta));
        setColumnWidths((current) =>
          current.map((value, index) => (index === drag.index ? width : value)),
        );
      } else {
        const height = Math.min(500, Math.max(36, drag.size + event.clientY - drag.start));
        setRowHeights((current) => ({ ...current, [drag.rowId]: height }));
      }
    };
    const stopResizing = () => {
      if (!resizeDrag.current) return;
      resizeDrag.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, []);

  const stats = useMemo(
    () => ({
      pending: rows.filter((row) => row.status === "pending").length,
      sent: rows.filter((row) => row.status === "sent").length,
      failed: rows.filter((row) => row.status === "failed").length,
    }),
    [rows],
  );
  const checkedRows = useMemo(
    () => rows.filter((row) => checkedRowIds.has(row.id)),
    [checkedRowIds, rows],
  );
  const allRowsChecked = rows.length > 0 && rows.every((row) => checkedRowIds.has(row.id));
  const someRowsChecked = checkedRows.length > 0 && !allRowsChecked;

  const toggleRowChecked = useCallback((rowId: string, checked: boolean) => {
    setCheckedRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  const toggleAllRowsChecked = useCallback((checked: boolean) => {
    setCheckedRowIds(checked ? new Set(rows.map((row) => row.id)) : new Set());
  }, [rows]);

  const startColumnResize = useCallback(
    (index: number, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeDrag.current = {
        kind: "column",
        index,
        start: event.clientX,
        size: columnWidths[index],
      };
      setIsResizing(true);
    },
    [columnWidths],
  );

  const startRowResize = useCallback(
    (rowId: string, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeDrag.current = {
        kind: "row",
        rowId,
        start: event.clientY,
        size: rowHeights[rowId] ?? 44,
      };
      setIsResizing(true);
    },
    [rowHeights],
  );

  const autoFitColumn = useCallback(
    (columnIndex: number) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        toast("Tidak dapat mengukur isi kolom.", "error");
        return;
      }

      const header = document.querySelectorAll<HTMLTableCellElement>("thead th")[columnIndex];
      const headerStyle = header ? getComputedStyle(header) : getComputedStyle(document.body);
      context.font = headerStyle.font;
      const heading = columnIndex === 0 ? "#" : columns[columnIndex - 1] ?? "Aksi";
      let widest = context.measureText(heading).width;
      if (columnIndex === 1) widest += 24;

      const fieldByColumn: (keyof ContactRow | null)[] = [
        null,
        "phone",
        "message",
        "status",
        "sentAt",
        "error",
        null,
      ];
      const field = fieldByColumn[columnIndex];
      if (field) {
        const cell = document.querySelector<HTMLTableCellElement>(`tbody tr td:nth-child(${columnIndex + 1})`);
        context.font = cell ? getComputedStyle(cell).font : getComputedStyle(document.body).font;
        for (const [index, row] of rows.entries()) {
          const value =
            field === "status"
              ? statusLabels[row.status]
              : field === "sentAt"
                ? formatTime(row.sentAt)
                : String(row[field] ?? "");
          for (const line of value.split(/\r?\n/)) {
            widest = Math.max(widest, context.measureText(line).width);
          }
          if (columnIndex === 0) widest = Math.max(widest, context.measureText(String(index + 1)).width);
        }
      } else if (columnIndex === 6) {
        widest = Math.max(widest, 120);
      } else {
        for (let index = 0; index < rows.length; index += 1) {
          widest = Math.max(widest, context.measureText(String(index + 1)).width);
        }
      }

      const extraWidth = columnIndex === 1 ? 64 : columnIndex === 6 ? 16 : 32;
      const minimum = columnIndex === 0 ? 48 : 80;
      const fittedWidth = Math.min(1200, Math.max(minimum, Math.ceil(widest + extraWidth)));
      setColumnWidths((current) =>
        current.map((width, index) => (index === columnIndex ? fittedWidth : width)),
      );
    },
    [rows, toast],
  );

  const measureRowHeight = useCallback(
    (row: ContactRow, rowIndex: number, widths: number[]) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return null;

      const preview = document.querySelector<HTMLElement>(
        `tbody tr:nth-child(${rowIndex + 1}) .message-preview`,
      );
      const style = preview ? getComputedStyle(preview) : getComputedStyle(document.body);
      context.font = style.font;
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20;
      const messageWidth = Math.max(1, (widths[2] ?? initialColumnWidths[2]) - 64);
      const messageLines = wrappedLineCount(context, row.message, messageWidth);
      return Math.min(600, Math.max(44, Math.ceil(messageLines * lineHeight + 12)));
    },
    [],
  );

  const autoFitColumnSelection = useCallback((columnIndex: number) => {
    const range = selectionModeRef.current === "column" ? selectionRef.current : null;
    const first = range ? range.c1 + 1 : columnIndex;
    const last = range ? range.c2 + 1 : columnIndex;
    for (let column = first; column <= last; column += 1) autoFitColumn(column);
  }, [autoFitColumn]);

  const autoFitRowSelection = useCallback((rowId: string) => {
    const clickedIndex = rows.findIndex((row) => row.id === rowId);
    if (clickedIndex < 0) return;
    const range = selectionModeRef.current === "row" ? selectionRef.current : null;
    const first = range?.r1 ?? clickedIndex;
    const last = range?.r2 ?? clickedIndex;

    const nextHeights: Record<string, number> = {};
    for (let rowIndex = first; rowIndex <= last; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) continue;
      const height = measureRowHeight(row, rowIndex, columnWidths);
      if (height === null) {
        toast("Tidak dapat mengukur isi baris.", "error");
        return;
      }
      nextHeights[row.id] = height;
    }
    setRowHeights((current) => ({ ...current, ...nextHeights }));
  }, [columnWidths, measureRowHeight, rows, toast]);

  const setCellSelection = useCallback(
    (cell: Cell, extend = false) => {
      const currentAnchor = anchorRef.current;
      const nextAnchor = extend && currentAnchor ? currentAnchor : cell;
      const nextSelection = extend && currentAnchor ? rectBetween(currentAnchor, cell) : rectBetween(cell, cell);
      selectionModeRef.current = "cell";
      anchorRef.current = nextAnchor;
      activeRef.current = cell;
      selectionRef.current = nextSelection;
      setAnchor(nextAnchor);
      setActive(cell);
      setSelection(nextSelection);
      requestAnimationFrame(() => cellRefs.current.get(`${cell.row}:${cell.col}`)?.focus());
    },
    [],
  );

  const beginDragSelection = useCallback((event: React.PointerEvent<HTMLTableElement>) => {
    if (event.button !== 0) return;
    suppressGridClickRef.current = false;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("input, textarea, button, [role=checkbox], .column-resize-handle, .row-resize-handle")) return;
    const cell = event.target.closest<HTMLElement>("[data-grid-cell]");
    if (!cell) return;
    const [row, col] = (cell.dataset.gridCell ?? "").split(":").map(Number);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    const anchorCell = { row, col };
    dragSelectionRef.current = { anchor: anchorCell, pointerId: event.pointerId };
    suppressGridClickRef.current = false;
    setIsSelecting(true);
    selectionModeRef.current = "cell";
    anchorRef.current = anchorCell;
    activeRef.current = anchorCell;
    selectionRef.current = rectBetween(anchorCell, anchorCell);
    setAnchor(anchorCell);
    setActive(anchorCell);
    setSelection(rectBetween(anchorCell, anchorCell));
  }, []);

  const updateDragSelection = useCallback((target: EventTarget | null) => {
    const drag = dragSelectionRef.current;
    if (!drag || !(target instanceof Element)) return;
    const cell = target.closest<HTMLElement>("[data-grid-cell]");
    if (!cell) return;
    const [row, col] = (cell.dataset.gridCell ?? "").split(":").map(Number);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    const nextCell = { row, col };
    if (nextCell.row !== drag.anchor.row || nextCell.col !== drag.anchor.col) {
      suppressGridClickRef.current = true;
    }
    const nextSelection = rectBetween(drag.anchor, nextCell);
    activeRef.current = nextCell;
    selectionRef.current = nextSelection;
    setActive(nextCell);
    setSelection(nextSelection);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (dragSelectionRef.current?.pointerId !== event.pointerId) return;
      updateDragSelection(document.elementFromPoint(event.clientX, event.clientY));
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (dragSelectionRef.current?.pointerId === event.pointerId) {
        dragSelectionRef.current = null;
        setIsSelecting(false);
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [updateDragSelection]);

  const selectColumn = useCallback((column: number, extend: boolean) => {
    if (!rows.length) return;
    const currentAnchor = anchorRef.current;
    const startColumn =
      extend && selectionModeRef.current === "column" && currentAnchor
        ? currentAnchor.col
        : column;
    const nextAnchor = { row: 0, col: startColumn };
    const nextActive = { row: rows.length - 1, col: column };
    const nextSelection = {
      r1: 0,
      c1: Math.min(startColumn, column),
      r2: rows.length - 1,
      c2: Math.max(startColumn, column),
    };
    selectionModeRef.current = "column";
    anchorRef.current = nextAnchor;
    activeRef.current = nextActive;
    selectionRef.current = nextSelection;
    setAnchor(nextAnchor);
    setActive(nextActive);
    setSelection(nextSelection);
  }, [rows.length]);

  const selectRow = useCallback((row: number, extend: boolean) => {
    const currentAnchor = anchorRef.current;
    const startRow =
      extend && selectionModeRef.current === "row" && currentAnchor
        ? currentAnchor.row
        : row;
    const nextAnchor = { row: startRow, col: 0 };
    const nextActive = { row, col: columns.length - 1 };
    const nextSelection = {
      r1: Math.min(startRow, row),
      c1: 0,
      r2: Math.max(startRow, row),
      c2: columns.length - 1,
    };
    selectionModeRef.current = "row";
    anchorRef.current = nextAnchor;
    activeRef.current = nextActive;
    selectionRef.current = nextSelection;
    setAnchor(nextAnchor);
    setActive(nextActive);
    setSelection(nextSelection);
  }, []);

  const changeCell = useCallback((rowIndex: number, key: "phone" | "message", value: string) => {
    updateRows((current) =>
      current.map((row, index) =>
        index !== rowIndex
          ? row
          : {
              ...row,
              [key]: value,
              ...(row.status !== "pending" ? { status: "pending" as const, sentAt: "", error: "" } : {}),
            },
      ),
    );
  }, [updateRows]);

  const openMessageEditor = useCallback((row: ContactRow, rowIndex: number) => {
    if (sending) return;
    setMessageDataMenu(null);
    setMessageEditor({ rowId: row.id, rowNumber: rowIndex + 1, value: row.message });
  }, [sending]);

  const saveMessageEditor = useCallback(() => {
    if (!messageEditor || sending) return;
    const rowIndex = rows.findIndex((row) => row.id === messageEditor.rowId);
    if (rowIndex < 0) {
      setMessageEditor(null);
      toast("Baris pesan tidak ditemukan.", "error");
      return;
    }
    if (rows[rowIndex].message !== messageEditor.value) {
      changeCell(rowIndex, "message", messageEditor.value);
    }
    setMessageDataMenu(null);
    setMessageEditor(null);
  }, [changeCell, messageEditor, rows, sending, toast]);

  const insertMessageData = useCallback((key: string) => {
    if (!messageDataMenu) return;
    const rowIndex = rows.findIndex((row) => row.id === messageDataMenu.rowId);
    if (rowIndex < 0) {
      setMessageDataMenu(null);
      toast("Baris pesan tidak ditemukan.", "error");
      return;
    }

    const token = `{{${key}}}`;
    if (messageDataMenu.target === "editor" && messageEditor?.rowId === messageDataMenu.rowId) {
      const start = messageDataMenu.selectionStart ?? messageEditor.value.length;
      const end = messageDataMenu.selectionEnd ?? start;
      const value = `${messageEditor.value.slice(0, start)}${token}${messageEditor.value.slice(end)}`;
      setMessageEditor({ ...messageEditor, value });
      requestAnimationFrame(() => {
        messageTextareaRef.current?.focus();
        messageTextareaRef.current?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      changeCell(rowIndex, "message", `${rows[rowIndex].message}${token}`);
    }
    setMessageDataMenu(null);
  }, [changeCell, messageDataMenu, messageEditor, rows, toast]);

  const addRows = useCallback(
    (count = 1) => {
      if (sending) return;
      if (rows.length + count > MAX_ROWS) {
        toast("Maksimal 10.000 baris.", "error");
        return;
      }
      const first = rows.length;
      updateRows((current) => [...current, ...Array.from({ length: count }, newRow)]);
      setPage("table");
      setCellSelection({ row: first, col: 0 });
    },
    [rows.length, sending, setCellSelection, toast, updateRows],
  );

  const patchRow = useCallback((id: string, update: Partial<ContactRow>) => {
    updateRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  }, [updateRows]);

  const resetRow = useCallback(
    (rowIndex: number) => {
      if (sending) {
        toast("Tunggu pengiriman selesai.", "info");
        return;
      }
      const row = rows[rowIndex];
      if (!row) return;
      patchRow(row.id, { status: "pending", sentAt: "", error: "" });
      toast(`Status baris ${rowIndex + 1} direset ke pending`, "info", 2000);
    },
    [patchRow, rows, sending, toast],
  );

  const deleteRows = useCallback(
    async (rowIndex: number, count = 1) => {
      if (sending) {
        toast("Tunggu pengiriman selesai sebelum menghapus data.", "info");
        return;
      }
      const ok = await confirm({
        title: count > 1 ? "Hapus baris terpilih?" : "Hapus baris?",
        message:
          count > 1
            ? `${count} baris akan dihapus. Tindakan ini tidak dapat dibatalkan.`
            : `Baris ${rowIndex + 1} akan dihapus. Tindakan ini tidak dapat dibatalkan.`,
        confirmText: "Hapus",
        danger: true,
      });
      if (!ok) return;
      updateRows((current) => current.filter((_, index) => index < rowIndex || index >= rowIndex + count));
      setActive(null);
      setSelection(null);
      setAnchor(null);
      toast(`${count} baris dihapus`, "info", 2000);
    },
    [confirm, sending, toast, updateRows],
  );

  const runSend = useCallback(
    async (targets: ContactRow[]) => {
      if (!targets.length || sending) return;
      stopRequested.current = false;
      setSending(true);
      setProgress({ done: 0, total: targets.length });
      const waitSeconds = Math.min(300, Math.max(0, Math.round(Number(delay) || 0)));
      let success = 0;
      let failed = 0;
      let stopped = false;

      for (let index = 0; index < targets.length; index += 1) {
        if (stopRequested.current) {
          stopped = true;
          break;
        }
        if (waRef.current.connection !== "open") {
          addLog("WhatsApp terputus. Pengiriman dihentikan.", "error");
          toast("WhatsApp terputus. Pengiriman dihentikan.", "error");
          stopped = true;
          break;
        }

        const row = targets[index];
        patchRow(row.id, { status: "sending", error: "" });
        setProgress({ done: index, total: targets.length });

        let result;
        try {
          result = await window.bulkWA.send({
            phone: row.phone,
            message: resolveMessageTemplate(row.message, row.sourceData),
          });
        } catch (error) {
          result = { ok: false, error: errorMessage(error) };
        }

        if (result?.ok) {
          patchRow(row.id, { status: "sent", sentAt: new Date().toISOString(), error: "" });
          success += 1;
          addLog(`${row.phone} — terkirim`, "success");
        } else {
          const error = result?.error || "Gagal mengirim pesan";
          patchRow(row.id, { status: "failed", error });
          failed += 1;
          addLog(`${row.phone} — ${error}`, "error");
        }
        setProgress({ done: index + 1, total: targets.length });

        if (index < targets.length - 1 && !stopRequested.current && waitSeconds > 0) {
          const stop = await delayOrStop(waitSeconds * 1000, stopRequested);
          if (stop) {
            stopped = true;
            break;
          }
        }
      }

      setSending(false);
      stopRequested.current = false;
      const summary = stopped
        ? `Pengiriman dihentikan. ${success} terkirim, ${failed} gagal.`
        : `Selesai. ${success} terkirim, ${failed} gagal.`;
      const kind = failed > 0 ? "error" : stopped ? "info" : "success";
      addLog(summary, kind);
      toast(summary, kind, 6000);
    },
    [addLog, delay, patchRow, sending, toast],
  );

  const startBulkSend = useCallback(async () => {
    if (sending) return;
    if (wa.connection !== "open") {
      toast("Hubungkan WhatsApp terlebih dahulu.", "error");
      setPage("whatsapp");
      return;
    }
    const targets = rows.filter(
      (row) => row.phone.trim() && row.message.trim() && (!skipSent || row.status !== "sent"),
    );
    if (!targets.length) {
      toast(
        skipSent
          ? "Tidak ada pesan yang perlu dikirim. Semua baris valid sudah terkirim."
          : "Tidak ada baris valid. Isi WA Number dan WA Message terlebih dahulu.",
      );
      return;
    }
    const waitSeconds = Math.min(300, Math.max(0, Math.round(Number(delay) || 0)));
    const ok = await confirm({
      title: "Kirim pesan massal?",
      message: `${targets.length} pesan akan dikirim satu per satu dengan jeda ${waitSeconds} detik.\n\nPastikan nomor dan isi pesan sudah benar.`,
      confirmText: `Kirim ${targets.length} pesan`,
    });
    if (ok) await runSend(targets);
  }, [confirm, delay, rows, runSend, sending, skipSent, toast, wa.connection]);

  const sendCheckedRows = useCallback(async () => {
    if (sending) return;
    if (wa.connection !== "open") {
      toast("Hubungkan WhatsApp terlebih dahulu.", "error");
      setPage("whatsapp");
      return;
    }

    const targets = checkedRows.filter(
      (row) =>
        row.phone.trim() &&
        row.message.trim() &&
        (!skipSent || row.status !== "sent"),
    );
    if (!targets.length) {
      toast(
        skipSent
          ? "Tidak ada pesan valid yang dipilih untuk dikirim. Pesan terkirim akan dilewati."
          : "Tidak ada baris valid yang dipilih. Lengkapi WA Number dan WA Message.",
        "info",
      );
      return;
    }

    const waitSeconds = Math.min(300, Math.max(0, Math.round(Number(delay) || 0)));
    const ok = await confirm({
      title: "Kirim pesan pada baris terpilih?",
      message: `${targets.length} dari ${checkedRows.length} baris terpilih akan dikirim satu per satu dengan jeda ${waitSeconds} detik.`,
      confirmText: `Kirim ${targets.length} pesan`,
    });
    if (ok) await runSend(targets);
  }, [checkedRows, confirm, delay, runSend, sending, skipSent, toast, wa.connection]);

  const deleteCheckedRows = useCallback(async () => {
    if (sending || !checkedRows.length) return;
    const count = checkedRows.length;
    const ok = await confirm({
      title: "Hapus baris terpilih?",
      message: `${count} baris akan dihapus. Tindakan ini tidak dapat dibatalkan.`,
      confirmText: `Hapus ${count} baris`,
      danger: true,
    });
    if (!ok) return;

    const deletedIds = new Set(checkedRows.map((row) => row.id));
    updateRows((current) => current.filter((row) => !deletedIds.has(row.id)));
    setCheckedRowIds(new Set());
    setActive(null);
    setSelection(null);
    setAnchor(null);
    toast(`${count} baris dihapus`, "info", 2000);
  }, [checkedRows, confirm, sending, toast, updateRows]);

  const sendSingle = useCallback(
    async (rowIndex: number) => {
      if (sending) return;
      if (wa.connection !== "open") {
        toast("Hubungkan WhatsApp terlebih dahulu.", "error");
        setPage("whatsapp");
        return;
      }
      const row = rows[rowIndex];
      if (!row?.phone.trim() || !row.message.trim()) {
        toast("Lengkapi WA Number dan WA Message terlebih dahulu.", "info");
        return;
      }
      await runSend([row]);
    },
    [rows, runSend, sending, toast, wa.connection],
  );

  const importExcel = useCallback(async () => {
    if (sending) return;
    let result: ImportResult;
    try {
      const selectedFile = await window.bulkWA.selectImportFile();
      if (selectedFile?.canceled) return;
      if (selectedFile?.error) {
        toast(selectedFile.error, "error", 6000);
        return;
      }

      const sheetNames = selectedFile?.sheetNames || [];
      if (!selectedFile.importId || !sheetNames.length) {
        toast("File Excel tidak memiliki sheet.", "error", 6000);
        return;
      }

      const sheetName =
        sheetNames.length === 1 ? sheetNames[0] : await askForSheet(sheetNames);
      if (sheetName === null) return;

      result = await window.bulkWA.importSheet(selectedFile.importId, sheetName);
    } catch (error) {
      toast(`Gagal mengimport Excel: ${errorMessage(error)}`, "error");
      return;
    }
    if (result?.canceled) return;
    if (result?.error) {
      toast(result.error, "error", 6000);
      return;
    }
    const imported = (result?.rows || []).map(normalizeRow).filter((row) => row.phone || row.message);
    if (!imported.length) {
      toast("Tidak ada data valid ditemukan di file Excel.", "info");
      return;
    }
    const dataset: MessageDataset = {
      id: uid(),
      name: result.fileName || "Data Excel",
      sheet: result.sheet || "",
      rows: imported.slice(0, MAX_ROWS),
    };
    setDatasets((current) => [...current, dataset]);
    setActiveDatasetId(dataset.id);
    setCheckedRowIds(new Set());
    setActive({ row: 0, col: 0 });
    setAnchor({ row: 0, col: 0 });
    setSelection({ r1: 0, c1: 0, r2: 0, c2: 0 });
    setRowHeights({});
    setPage("table");
    toast(`${imported.length} baris berhasil diimport`, "success");
    if (result.truncated) {
      toast("File berisi lebih dari 10.000 baris. Hanya 10.000 baris pertama yang diimport.", "info", 7000);
    }
  }, [askForSheet, sending, toast]);

  const exportExcel = useCallback(async () => {
    if (sending) {
      toast("Tunggu pengiriman selesai sebelum export.", "info");
      return;
    }
    if (!rows.length) {
      toast("Belum ada data untuk diexport.", "info");
      return;
    }
    const sheetName = await askForInput({
      title: "Nama tab Excel",
      message: "Tentukan nama tab/sheet yang akan dibuat pada file export (maksimal 31 karakter).",
      value: "WHATSAPPS",
      confirmText: "Lanjutkan",
    });
    if (sheetName === null) return;
    try {
      const result = await window.bulkWA.exportRows(rows, sheetName);
      if (result?.canceled) return;
      if (result?.error) {
        toast(result.error, "error", 6000);
        return;
      }
      toast(`Data diexport ke ${result.filePath?.split(/[\\/]/).pop() || "file Excel"}`, "success", 5000);
    } catch (error) {
      toast(`Gagal mengexport Excel: ${errorMessage(error)}`, "error", 6000);
    }
  }, [askForInput, rows, sending, toast]);

  const changeConnection = useCallback(
    async (action: "connect" | "logout" | "reset") => {
      if (action === "logout" || action === "reset") {
        if (sending) {
          toast("Tunggu pengiriman selesai sebelum reset sesi.", "info");
          return;
        }
        const ok = await confirm({
          title: action === "logout" ? "Putuskan WhatsApp?" : "Reset sesi WhatsApp?",
          message:
            action === "logout"
              ? "Koneksi akan diputuskan dan sesi dihapus. Anda perlu scan QR kembali untuk menghubungkan akun."
              : "Sesi saat ini akan dihapus dan QR baru akan ditampilkan. Gunakan ini jika QR tidak muncul atau ingin berganti akun.",
          confirmText: action === "logout" ? "Putuskan" : "Reset Sesi",
          danger: true,
        });
        if (!ok) return;
      }
      try {
        const result =
          action === "connect"
            ? await window.bulkWA.connect()
            : action === "logout"
              ? await window.bulkWA.logout()
              : await window.bulkWA.reset();
        setWa(result);
        if (action === "logout") addLog("Sesi WhatsApp diputuskan");
        if (action === "reset") addLog("Sesi direset. Menunggu QR baru.");
      } catch (error) {
        toast(`Gagal ${action === "connect" ? "menghubungkan" : action === "logout" ? "memutuskan koneksi" : "reset sesi"}: ${errorMessage(error)}`, "error");
      }
    },
    [addLog, confirm, sending, toast],
  );

  const copySelection = useCallback(
    (cut = false) => {
      const rect = selectionRef.current;
      if (!rect) return;
      const lines: string[] = [];
      for (let rowIndex = rect.r1; rowIndex <= rect.r2; rowIndex += 1) {
        const row = rows[rowIndex];
        const values: string[] = [];
        for (let colIndex = rect.c1; colIndex <= rect.c2; colIndex += 1) {
          const key = ["phone", "message", "status", "sentAt", "error"][colIndex] as keyof ContactRow;
          values.push(String(row?.[key] ?? ""));
        }
        lines.push(values.join("\t"));
      }
      const text = lines.join("\n");
      window.bulkWA.copyText(text);
      setClipboardText(text);
      const count = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
      toast(`${count} sel ${cut ? "dipotong" : "disalin"} ke clipboard`, "info", 2200);
      if (cut) clearSelection(rect);
    },
    [rows, toast],
  );

  function clearSelection(rect: Selection) {
    updateRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex < rect.r1 || rowIndex > rect.r2) return row;
        const next = { ...row };
        if (rect.c1 <= 0 && rect.c2 >= 0) next.phone = "";
        if (rect.c1 <= 1 && rect.c2 >= 1) next.message = "";
        if (next.phone !== row.phone || next.message !== row.message) {
          next.status = "pending";
          next.sentAt = "";
          next.error = "";
        }
        return next;
      }),
    );
  }

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTableElement>) => {
      const text = event.clipboardData.getData("text/plain");
      if (!text || !activeRef.current) return;
      if (sending) {
        event.preventDefault();
        toast("Tunggu pengiriman selesai sebelum menempel data.", "info");
        return;
      }
      const matrix = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (matrix.length > 1 && matrix[matrix.length - 1] === "") matrix.pop();
      const cells = matrix.map((line) => line.split("\t"));
      if (cells.length === 1 && cells[0].length === 1) return;
      event.preventDefault();
      const start = activeRef.current;
      if (start.col > 1) {
        toast("Pilih sel WA Number atau WA Message terlebih dahulu.", "info");
        return;
      }
      const required = Math.min(MAX_ROWS, start.row + cells.length);
      updateRows((current) => {
        const next = current.slice();
        while (next.length < required) next.push(newRow());
        cells.forEach((values, offset) => {
          const rowIndex = start.row + offset;
          if (rowIndex >= MAX_ROWS) return;
          const row = { ...next[rowIndex] };
          values.forEach((value, columnOffset) => {
            const column = start.col + columnOffset;
            if (column === 0) row.phone = value;
            if (column === 1) row.message = value;
          });
          row.status = "pending";
          row.sentAt = "";
          row.error = "";
          next[rowIndex] = row;
        });
        return next;
      });
      const end = { row: Math.min(MAX_ROWS - 1, start.row + cells.length - 1), col: Math.min(4, start.col + Math.max(...cells.map((line) => line.length)) - 1) };
      setAnchor(start);
      setActive(start);
      setSelection(rectBetween(start, end));
      toast(`${cells.length} baris ditempel dari clipboard`, "success", 2200);
    },
    [sending, toast, updateRows],
  );

  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>) => {
      const cell = activeRef.current;
      if (!cell) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "x") {
        event.preventDefault();
        copySelection(true);
        return;
      }
      if (event.target instanceof HTMLInputElement && !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      let next: Cell | null = null;
      switch (event.key) {
        case "ArrowUp":
          next = { row: cell.row - 1, col: cell.col };
          break;
        case "ArrowDown":
        case "Enter":
          next = { row: cell.row + 1, col: cell.col };
          break;
        case "ArrowLeft":
          next = { row: cell.row, col: cell.col - 1 };
          break;
        case "ArrowRight":
        case "Tab":
          next = event.shiftKey
            ? cell.col > 0
              ? { row: cell.row, col: cell.col - 1 }
              : { row: cell.row - 1, col: columns.length - 1 }
            : cell.col < columns.length - 1
              ? { row: cell.row, col: cell.col + 1 }
              : { row: cell.row + 1, col: 0 };
          break;
        case "Home":
          next = { row: cell.row, col: 0 };
          break;
        case "End":
          next = { row: cell.row, col: columns.length - 1 };
          break;
        default:
          return;
      }
      event.preventDefault();
      const row = Math.min(rows.length - 1, Math.max(0, next.row));
      const col = Math.min(columns.length - 1, Math.max(0, next.col));
      setCellSelection({ row, col }, event.shiftKey);
    },
    [copySelection, rows.length, setCellSelection],
  );

  const startSelection = selection
    ? selection.r2 - selection.r1 + 1
    : active
      ? 1
      : 0;
  const editorSourceFields = messageEditor
    ? Object.entries(rows.find((row) => row.id === messageEditor.rowId)?.sourceData ?? {})
        .filter(([key]) => key.trim())
    : [];
  const connection = wa.connection;
  const account = formatNumber(wa.me);

  return (
    <div className="app-shell flex h-screen min-w-[980px] text-slate-900">
      <aside className="app-sidebar flex w-64 shrink-0 flex-col px-4 py-6 text-white">
        <div className="mb-9 flex items-center gap-3 px-2">
          <div className="app-brand-mark grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white"><MessageCircle className="size-5" /></div>
          <div>
            <div className="text-[17px] font-bold tracking-tight">Bulk WA</div>
            <div className="mt-0.5 text-[11px] font-medium tracking-wide text-emerald-200/75">MESSAGE WORKSPACE</div>
          </div>
        </div>
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200/50">Workspace</div>
        <nav className="space-y-1.5 overflow-y-auto px-1" aria-label="Menu utama">
          <NavButton active={page === "whatsapp"} onClick={() => setPage("whatsapp")}>
            <Wifi aria-hidden="true" />
            WhatsApp
          </NavButton>
          <NavButton active={page === "datasets" || page === "table"} onClick={() => setPage("datasets")}>
            <Table2 aria-hidden="true" />
            Tabel Pesan
            <Badge variant="secondary" className="ml-auto border-0 bg-white/10 text-white">
              {datasets.length}
            </Badge>
          </NavButton>
          {datasets.map((dataset) => (
            <Button
              key={dataset.id}
              variant="ghost"
              title={dataset.name}
              disabled={sending}
              aria-current={page === "table" && activeDatasetId === dataset.id ? "page" : undefined}
              className={`dataset-nav-item ml-4 h-auto min-h-10 w-[calc(100%-1rem)] justify-start gap-2 px-3 py-2 text-left text-xs ${
                page === "table" && activeDatasetId === dataset.id
                  ? "bg-emerald-700 text-white hover:bg-emerald-700 hover:text-white"
                  : "text-emerald-200 hover:bg-white/10 hover:text-white"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                openDataset(dataset.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setDatasetContextMenu({
                  datasetId: dataset.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <FileSpreadsheet aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{dataset.name}</span>
                {dataset.sheet && <span className="block truncate text-[10px] opacity-70">{dataset.sheet}</span>}
              </span>
              <span className="shrink-0 text-[10px] opacity-70">{dataset.rows.length}</span>
            </Button>
          ))}
        </nav>
        {datasetContextMenu && (
          <>
            <button
              type="button"
              aria-label="Tutup menu dataset"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setDatasetContextMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault();
                setDatasetContextMenu(null);
              }}
            />
            <div
              role="menu"
              aria-label="Opsi file Excel"
              className="fixed z-50 min-w-56 rounded-md border border-slate-200 bg-white p-1 text-slate-800 shadow-lg"
              style={{
                top: Math.min(datasetContextMenu.y, window.innerHeight - 56),
                left: Math.min(datasetContextMenu.x, window.innerWidth - 232),
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-destructive hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none"
                disabled={sending}
                onClick={() => {
                  const dataset = datasets.find((item) => item.id === datasetContextMenu.datasetId);
                  if (dataset) void disconnectDataset(dataset);
                  else setDatasetContextMenu(null);
                }}
              >
                <Unlink aria-hidden="true" className="size-4" />
                Putuskan koneksi ke Excel
              </button>
            </div>
          </>
        )}
        <div className="sidebar-connection mt-auto rounded-2xl p-3.5">
          <div className="flex items-center gap-2 text-sm">
            <span className={`relative size-2 rounded-full ${connection === "open" ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : connection === "qr" ? "bg-amber-400" : "bg-slate-400"}`} />
            <span className="font-medium">{connectionLabels[connection]}</span>
          </div>
          <div className="mt-1.5 truncate pl-4 text-xs text-emerald-100/60">{account ? `+${account}` : "WhatsApp belum terhubung"}</div>
        </div>
        <div className="mt-4 flex items-center justify-between px-2 text-[10px] font-medium tracking-wide text-emerald-100/40">
          <span>ELECTRON DESKTOP</span><span>v1.0</span>
        </div>
      </aside>

      <main className="app-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="app-topbar flex items-center justify-between border-b px-8 py-5">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700/70">
              {page === "whatsapp" ? "OVERVIEW" : page === "datasets" ? "MESSAGE DATA" : "SPREADSHEET"}
            </div>
            <h1 className="text-[21px] font-bold tracking-tight text-slate-800">
              {page === "whatsapp"
                ? "WhatsApp"
                : page === "datasets"
                  ? "Data Excel"
                  : activeDataset?.name ?? "Tabel Pesan"}
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {page === "whatsapp"
                ? "Hubungkan akun dan pantau hasil pengiriman pesan."
                : page === "datasets"
                  ? "Ringkasan file Excel yang telah diimport."
                  : `Sheet: ${activeDataset?.sheet || "—"} • Edit data lalu kirim massal.`}
            </p>
          </div>
          <Badge className="gap-1.5 px-3 py-1.5" variant={connection === "open" ? "success" : connection === "qr" ? "warning" : "muted"}>
            <span className={`size-1.5 rounded-full ${connection === "open" ? "bg-emerald-600" : connection === "qr" ? "bg-amber-600" : "bg-slate-400"}`} />
            {connectionLabels[connection]}
          </Badge>
        </header>

        <div className="app-content flex min-h-0 flex-1 flex-col">
        {page === "whatsapp" ? (
          <section className="flex min-h-0 flex-1 gap-5 overflow-auto p-7">
            <Card className="flex min-w-0 flex-1 flex-col">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>Koneksi WhatsApp</CardTitle>
                  <CardDescription className="mt-2">Scan QR menggunakan menu Linked Devices di WhatsApp ponsel Anda.</CardDescription>
                </div>
                <Badge variant={connection === "open" ? "success" : connection === "qr" ? "warning" : "muted"}>{connectionLabels[connection]}</Badge>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col">
              <div className="my-7 flex flex-1 items-center justify-center rounded-2xl border border-emerald-100/80 bg-[radial-gradient(ellipse_at_top,#f0faf4,#f8faf9_72%)] p-5">
                {connection === "open" ? (
                  <div className="text-center">
                    <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-8" /></div>
                    <strong>WhatsApp terhubung</strong>
                    <p className="mt-2 text-sm text-slate-500">{account ? `Nomor +${account} siap mengirim pesan.` : "Siap mengirim pesan massal."}</p>
                  </div>
                ) : wa.qr ? (
                  <div className="text-center">
                    <img className="mx-auto max-h-80 rounded-xl bg-white p-2" src={wa.qr} alt="QR Code WhatsApp" />
                    <p className="mt-3 text-sm text-slate-600">Scan QR dengan WhatsApp di ponsel Anda.</p>
                  </div>
                ) : (
                  <div className="max-w-sm text-center">
                    {["connecting", "closed"].includes(connection) && <div className="mx-auto mb-4 size-9 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />}
                    <p className="text-sm text-slate-500">{wa.message || connectionCopy(connection)}</p>
                  </div>
                )}
              </div>
              <div className="mb-4 text-center text-sm text-slate-500">
                {wa.message || (account ? `Akun: +${account}` : "Belum ada akun terhubung")}
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="primary" disabled={["connecting", "qr", "open"].includes(connection)} onClick={() => void changeConnection("connect")}><Wifi />Hubungkan</Button>
                <Button variant="outline" disabled={!["open", "qr"].includes(connection)} onClick={() => void changeConnection("logout")}>Putuskan</Button>
                <Button variant="destructive" onClick={() => void changeConnection("reset")}>Reset Sesi</Button>
              </div>
              <p className="mt-4 text-center text-xs text-slate-400">QR berlaku sekitar 20 detik dan diperbarui otomatis. Jika QR tidak muncul, klik Reset Sesi.</p>
              </CardContent>
            </Card>

            <div className="flex w-80 shrink-0 flex-col gap-5">
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Pending" value={stats.pending} tone="slate" />
                <StatCard label="Terkirim" value={stats.sent} tone="green" />
                <StatCard label="Gagal" value={stats.failed} tone="red" />
              </div>
              <Card className="flex min-h-0 flex-1 flex-col">
                <CardHeader className="flex-row items-center justify-between space-y-0 p-5 pb-3">
                  <div>
                    <CardTitle className="text-base">Aktivitas</CardTitle>
                    <CardDescription className="mt-1 text-xs">Riwayat koneksi dan pengiriman.</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setLogs([])}>Bersihkan</Button>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 p-5 pt-0">
                <ScrollArea className="h-full">
                <div className="space-y-3 pr-3">
                  {logs.length ? logs.map((item) => (
                    <div key={item.id} className="flex gap-3 text-xs">
                      <time className="shrink-0 text-slate-400">{item.time}</time>
                      <p className={item.kind === "error" ? "text-red-600" : item.kind === "success" ? "text-emerald-700" : "text-slate-600"}>{item.message}</p>
                    </div>
                  )) : <p className="text-sm text-slate-400">Belum ada aktivitas.</p>}
                </div>
                </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </section>
        ) : page === "datasets" ? (
          <section className="flex min-h-0 flex-1 flex-col p-7">
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-5">
                <div>
                  <CardTitle className="text-base">File Excel yang diimport</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Pilih file untuk membuka tabel pesannya.
                  </CardDescription>
                </div>
                <Button variant="primary" disabled={sending} onClick={() => void importExcel()}>
                  <FileUp />Import Excel
                </Button>
              </div>
              <div className="flat-scrollbar min-h-0 flex-1 overflow-auto">
                {datasets.length ? (
                  <Table className="min-w-[700px]">
                    <TableHeader className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide">
                      <TableRow>
                        <TableHead>Nama Excel</TableHead>
                        <TableHead className="w-36 text-right">Pending</TableHead>
                        <TableHead className="w-36 text-right">Terkirim</TableHead>
                        <TableHead className="w-36 text-right">Gagal</TableHead>
                        <TableHead className="w-32 text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datasets.map((dataset) => {
                        const counts = datasetCounts(dataset.rows);
                        return (
                          <TableRow
                            key={dataset.id}
                            className="cursor-pointer"
                            onClick={() => openDataset(dataset.id)}
                          >
                            <TableCell>
                              <button
                                type="button"
                                className="flex min-w-0 items-center gap-3 text-left"
                                onClick={() => openDataset(dataset.id)}
                              >
                                <FileSpreadsheet className="size-5 shrink-0 text-emerald-700" />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-slate-800">{dataset.name}</span>
                                  {dataset.sheet && (
                                    <span className="block truncate text-xs text-slate-500">Sheet: {dataset.sheet}</span>
                                  )}
                                </span>
                              </button>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{counts.pending}</TableCell>
                            <TableCell className="text-right tabular-nums">{counts.sent}</TableCell>
                            <TableCell className="text-right tabular-nums">{counts.failed}</TableCell>
                            <TableCell className="text-right tabular-nums">{dataset.rows.length}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="grid h-full min-h-64 place-items-center p-8 text-center">
                    <div>
                      <FileSpreadsheet className="mx-auto size-10 text-slate-300" />
                      <p className="mt-3 font-medium text-slate-700">Belum ada file Excel</p>
                      <p className="mt-1 text-sm text-slate-500">Import file untuk membuat daftar data pesan.</p>
                      <Button className="mt-4" variant="outline" disabled={sending} onClick={() => void importExcel()}>
                        <FileUp />Import Excel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </section>
        ) : activeDataset ? (
          <section className="flex min-h-0 flex-1 flex-col p-7">
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="grid-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/90 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" disabled={sending} onClick={() => void startBulkSend()}><Send />Kirim Massal</Button>
                  {sending && <Button variant="destructive" onClick={() => { stopRequested.current = true; }}><X />Hentikan</Button>}
                  {sending && (
                    <div className="flex min-w-40 items-center gap-2 text-xs text-slate-500">
                      <Progress className="flex-1" value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} />
                      {progress.done} / {progress.total}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" disabled={sending} onClick={() => addRows()}><Plus />Baris</Button>
                  <Button variant="outline" disabled={sending || !rows.length} onClick={() => void deleteRows(selection?.r1 ?? active?.row ?? 0, startSelection)}><Trash2 />Hapus Baris</Button>
                  {checkedRows.length > 0 && (
                    <>
                      <Button
                        variant="outline"
                        disabled={sending}
                        onClick={() => void deleteCheckedRows()}
                      >
                        <Trash2 />Hapus Dipilih ({checkedRows.length})
                      </Button>
                      <Button
                        variant="primary"
                        disabled={sending}
                        onClick={() => void sendCheckedRows()}
                      >
                        <Send />Kirim Dipilih ({checkedRows.length})
                      </Button>
                    </>
                  )}
                  <Button variant="outline" disabled={sending} onClick={() => void importExcel()}><FileUp />Import Excel</Button>
                  <Button variant="outline" disabled={sending} onClick={() => void exportExcel()}><FileDown />Export Excel</Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-[#f7faf8] px-4 py-3 text-xs text-slate-500">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2">Jeda kirim
                    <Input className="h-8 w-20" type="number" min={0} max={300} value={delay} disabled={sending} onChange={(event) => setDelay(Number(event.target.value))} />
                    detik
                  </label>
                  <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={skipSent} disabled={sending} onCheckedChange={(checked) => setSkipSent(checked === true)} /> Lewati yang sudah terkirim</label>
                </div>
                <span>Seret sel untuk memilih rentang • Shift+klik header untuk memilih baris/kolom • double-click batas untuk auto-fit</span>
              </div>

              <div className={`flat-scrollbar min-h-0 flex-1 overflow-auto ${isResizing || isSelecting ? "select-none" : ""}`}>
                <Table
                  className="table-fixed text-left"
                  style={{
                    width: `${columnWidths.reduce((total, width) => total + width, 0)}px`,
                    minWidth: `${columnWidths.reduce((total, width) => total + width, 0)}px`,
                  }}
                  onKeyDown={handleGridKeyDown}
                  onPaste={handlePaste}
                  onPointerDownCapture={beginDragSelection}
                  onClickCapture={(event) => {
                    if (!suppressGridClickRef.current) return;
                    suppressGridClickRef.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <colgroup>
                    {columnWidths.map((width, index) => (
                      <col key={index} style={{ width: `${width}px` }} />
                    ))}
                  </colgroup>
                  <TableHeader className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="relative h-11 px-3">
                        #
                        <ColumnResizeHandle
                          onPointerDown={(event) => startColumnResize(0, event)}
                          onDoubleClick={() => autoFitColumnSelection(0)}
                        />
                      </TableHead>
                      {columns.map((column, columnIndex) => (
                        <TableHead
                          key={column}
                          className="relative h-11 cursor-pointer px-3"
                          title="Klik untuk memilih kolom • Shift+klik untuk memilih beberapa kolom"
                          onClick={(event) => {
                            if (
                              event.target instanceof Element &&
                              event.target.closest(".column-resize-handle, button, [role=checkbox]")
                            ) {
                              return;
                            }
                            selectColumn(columnIndex, event.shiftKey);
                          }}
                        >
                          {column === "WA Number" ? (
                            <span className="flex items-center gap-2">
                              <Checkbox
                                aria-label="Pilih semua baris"
                                checked={allRowsChecked ? true : someRowsChecked ? "indeterminate" : false}
                                disabled={!rows.length || sending}
                                onCheckedChange={(checked) => toggleAllRowsChecked(checked === true)}
                              />
                              <span>{column}</span>
                            </span>
                          ) : column}
                          <ColumnResizeHandle
                            onPointerDown={(event) => startColumnResize(columnIndex + 1, event)}
                            onDoubleClick={() => autoFitColumnSelection(columnIndex + 1)}
                          />
                        </TableHead>
                      ))}
                      <TableHead className="relative h-11 px-3">
                        Aksi
                        <ColumnResizeHandle
                          onPointerDown={(event) => startColumnResize(columnWidths.length - 1, event)}
                          onDoubleClick={() => autoFitColumnSelection(columnWidths.length - 1)}
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, rowIndex) => (
                      <TableRow key={row.id} className="group" style={{ height: `${rowHeights[row.id] ?? 44}px` }}>
                        <TableCell
                          className="relative cursor-pointer select-none px-3 py-2 text-center text-xs text-muted-foreground"
                          title="Klik untuk memilih baris"
                          onClick={(event) => {
                            event.preventDefault();
                            selectRow(rowIndex, event.shiftKey);
                          }}
                        >
                          {rowIndex + 1}
                          <RowResizeHandle
                            onPointerDown={(event) => startRowResize(row.id, event)}
                            onDoubleClick={() => autoFitRowSelection(row.id)}
                          />
                        </TableCell>
                        <TableCell data-grid-cell={`${rowIndex}:0`} className={cellClass(selection, active, rowIndex, 0)}>
                          <div className="flex items-center gap-2">
                          <Checkbox
                            aria-label={`Pilih baris ${rowIndex + 1}`}
                            checked={checkedRowIds.has(row.id)}
                            disabled={sending}
                            onCheckedChange={(checked) => toggleRowChecked(row.id, checked === true)}
                          />
                          <Input
                            ref={(element) => { if (element) cellRefs.current.set(`${rowIndex}:0`, element); else cellRefs.current.delete(`${rowIndex}:0`); }}
                            data-cell={`${rowIndex}:0`}
                            className="cell-input border-0 shadow-none focus-visible:ring-0"
                            aria-label={`WA Number baris ${rowIndex + 1}`}
                            value={row.phone}
                            disabled={sending}
                            onFocus={() => { if (activeRef.current?.row !== rowIndex || activeRef.current.col !== 0) setCellSelection({ row: rowIndex, col: 0 }); }}
                            onMouseDown={(event) => { if (event.shiftKey) setCellSelection({ row: rowIndex, col: 0 }, true); }}
                            onChange={(event) => changeCell(rowIndex, "phone", event.target.value)}
                          />
                          </div>
                        </TableCell>
                        <TableCell
                          data-grid-cell={`${rowIndex}:1`}
                          className={cellClass(selection, active, rowIndex, 1)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            if (sending) return;
                            setMessageDataMenu({
                              rowId: row.id,
                              x: event.clientX,
                              y: event.clientY,
                              target: "cell",
                            });
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <button
                              ref={(element) => {
                                if (element) cellRefs.current.set(`${rowIndex}:1`, element);
                                else cellRefs.current.delete(`${rowIndex}:1`);
                              }}
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              aria-label={`Lihat dan edit pesan baris ${rowIndex + 1}`}
                              title="Klik untuk memilih, klik dua kali untuk mengedit pesan lengkap"
                              disabled={sending}
                              onFocus={() => {
                                if (activeRef.current?.row !== rowIndex || activeRef.current.col !== 1) {
                                  setCellSelection({ row: rowIndex, col: 1 });
                                }
                              }}
                              onDoubleClick={() => openMessageEditor(row, rowIndex)}
                            >
                              {row.message ? (
                                <span
                                  className="message-preview block whitespace-pre-wrap break-words text-sm"
                                  style={{
                                    height: `${Math.max(24, (rowHeights[row.id] ?? 44) - 12)}px`,
                                  }}
                                >
                                  {resolveMessageTemplate(row.message, row.sourceData)}
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">Klik untuk menulis pesan</span>
                              )}
                            </button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground"
                              aria-label={`Edit pesan baris ${rowIndex + 1}`}
                              title="Buka editor pesan"
                              disabled={sending}
                              onClick={() => openMessageEditor(row, rowIndex)}
                            >
                              <Pencil />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell data-grid-cell={`${rowIndex}:2`} className={cellClass(selection, active, rowIndex, 2)} onClick={() => setCellSelection({ row: rowIndex, col: 2 })}><Badge variant={statusStyle(row.status)}>{statusLabels[row.status]}</Badge></TableCell>
                        <TableCell data-grid-cell={`${rowIndex}:3`} className={cellClass(selection, active, rowIndex, 3)} title={row.sentAt} onClick={() => setCellSelection({ row: rowIndex, col: 3 })}>{formatTime(row.sentAt)}</TableCell>
                        <TableCell data-grid-cell={`${rowIndex}:4`} className={cellClass(selection, active, rowIndex, 4)} title={row.error} onClick={() => setCellSelection({ row: rowIndex, col: 4 })}><span className="block truncate">{row.error}</span></TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-1">
                          <div className="flex items-center gap-1">
                            <RowAction title="Kirim baris ini" disabled={sending} onClick={() => void sendSingle(rowIndex)}><Send /></RowAction>
                            <RowAction title="Tandai pending" disabled={sending} onClick={() => resetRow(rowIndex)}><RefreshCw /></RowAction>
                            <RowAction title="Hapus baris" disabled={sending} danger onClick={() => void deleteRows(rowIndex)}><Trash2 /></RowAction>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && (
                      <TableRow className="hover:bg-transparent"><TableCell colSpan={7} className="px-6 py-16 text-center">
                        <p className="font-medium text-slate-700">Belum ada data</p>
                        <p className="mt-1 text-sm text-slate-500">Tambahkan baris baru atau import file Excel.</p>
                        <div className="mt-4 flex justify-center gap-2"><Button variant="primary" onClick={() => addRows()}><Plus />Tambah Baris</Button><Button variant="outline" onClick={() => void importExcel()}><FileUp />Import Excel</Button></div>
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
            <p className="mt-3 text-xs text-slate-400">{rows.length} baris • Salin/tempel data tab-delimited dari spreadsheet</p>
          </section>
        ) : (
          <section className="grid min-h-0 flex-1 place-items-center p-8 text-center">
            <div>
              <FileSpreadsheet className="mx-auto size-10 text-slate-300" />
              <p className="mt-3 font-medium text-slate-700">Pilih atau import file Excel</p>
              <Button className="mt-4" variant="primary" disabled={sending} onClick={() => void importExcel()}>
                <FileUp />Import Excel
              </Button>
            </div>
          </section>
        )}
        </div>
      </main>

      <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-96 flex-col gap-2" aria-live="polite">
        {toasts.map((item) => (
          <Card key={item.id} className={`border-0 px-4 py-3 text-sm shadow-lg ${item.kind === "error" ? "bg-destructive text-white" : item.kind === "success" ? "bg-primary text-primary-foreground" : "bg-foreground text-background"}`}>{item.message}</Card>
        ))}
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) settleDialog(null); }}>
        {dialog && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogDescription className="whitespace-pre-line leading-6">{dialog.message}</DialogDescription>
            </DialogHeader>
            {dialog.kind === "input" && (
              <div>
                <Input
                  autoFocus
                  maxLength={31}
                  className="mt-1"
                  aria-label="Nama tab Excel"
                  value={dialog.value || ""}
                  onChange={(event) => setDialog({ ...dialog, value: event.target.value, error: undefined })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const error = validateSheetName(dialog.value || "");
                      if (error) setDialog({ ...dialog, error });
                      else settleDialog((dialog.value || "").trim());
                    }
                    if (event.key === "Escape") settleDialog(null);
                  }}
                />
                {dialog.error && <p className="mt-2 text-sm text-destructive" role="alert">{dialog.error}</p>}
              </div>
            )}
            {dialog.kind === "sheet" && (
              <Select
                value={dialog.value}
                onValueChange={(value) => setDialog({ ...dialog, value })}
              >
                <SelectTrigger aria-label="Sheet Excel yang akan diimport">
                  <SelectValue placeholder="Pilih sheet" />
                </SelectTrigger>
                <SelectContent>
                  {dialog.sheetNames?.map((sheetName) => (
                    <SelectItem key={sheetName} value={sheetName}>{sheetName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => settleDialog(null)}>Batal</Button>
              <Button
                variant={dialog.danger ? "destructive" : "primary"}
                onClick={() => {
                  if (dialog.kind === "input") {
                    const error = validateSheetName(dialog.value || "");
                    if (error) setDialog({ ...dialog, error });
                    else settleDialog((dialog.value || "").trim());
                  } else if (dialog.kind === "sheet") {
                    if (dialog.value) settleDialog(dialog.value);
                  } else {
                    settleDialog(true);
                  }
                }}
              >{dialog.confirmText}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={Boolean(messageEditor)}
        onOpenChange={(open) => {
          if (!open) {
            setMessageEditor(null);
            setMessageDataMenu(null);
          }
        }}
      >
        {messageEditor && (
          <DialogContent className="max-w-4xl gap-5">
            <DialogHeader>
              <DialogTitle>Edit WA Message — Baris {messageEditor.rowNumber}</DialogTitle>
              <DialogDescription>
                Edit pesan lengkap di sini. Baris baru dan format pesan akan dipertahankan.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              ref={messageTextareaRef}
              autoFocus
              spellCheck
              className="min-h-[55vh] resize-y whitespace-pre-wrap font-sans leading-6"
              aria-label={`Isi pesan WhatsApp baris ${messageEditor.rowNumber}`}
              placeholder="Tulis pesan WhatsApp..."
              value={messageEditor.value}
              onContextMenu={(event) => {
                event.preventDefault();
                if (sending) return;
                const textarea = event.currentTarget;
                setMessageDataMenu({
                  rowId: messageEditor.rowId,
                  x: event.clientX,
                  y: event.clientY,
                  target: "editor",
                  selectionStart: textarea.selectionStart,
                  selectionEnd: textarea.selectionEnd,
                });
              }}
              onChange={(event) =>
                setMessageEditor({ ...messageEditor, value: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  saveMessageEditor();
                }
              }}
            />
            {messageDataMenu?.target === "editor" && (
              <div className="-mt-3 overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold">Sisipkan data baris ini</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    Pilih kolom untuk menyisipkan token personalisasi pada posisi kursor.
                  </div>
                </div>
                <div className="flat-scrollbar max-h-36 overflow-y-auto p-1.5">
                  {editorSourceFields.length ? (
                    editorSourceFields.map(([key, value]) => (
                        <button
                          key={key}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-emerald-50 focus-visible:bg-emerald-50 focus-visible:outline-none"
                          onClick={() => insertMessageData(key)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium">{key}</span>
                            <span className="block truncate text-[11px] text-slate-500">{value || "Kosong pada baris ini"}</span>
                          </span>
                          <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-1 font-mono text-[10px] text-emerald-800">
                            {"{{…}}"}
                          </span>
                        </button>
                      ))
                  ) : (
                    <p className="px-3 py-3 text-xs text-slate-500">
                      Tidak ada kolom sumber Excel pada baris ini.
                    </p>
                  )}
                </div>
              </div>
            )}
            <p className="-mt-3 text-xs text-muted-foreground">
              Klik kanan untuk menyisipkan kolom dari baris Excel ini. Token seperti {"{{Nama}}"} akan diisi otomatis saat pesan dikirim.
            </p>
            <div className="-mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{messageEditor.value.length.toLocaleString("id-ID")} karakter</span>
              <span>Ctrl+Enter untuk menyimpan</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setMessageEditor(null); setMessageDataMenu(null); }}>Batal</Button>
              <Button variant="primary" onClick={saveMessageEditor}><Check />Simpan Pesan</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      {messageDataMenu?.target === "cell" && (
        <>
          <button
            type="button"
            aria-label="Tutup pilihan data Excel"
            className="fixed inset-0 z-[70] cursor-default"
            onClick={() => setMessageDataMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMessageDataMenu(null);
            }}
          />
          <div
            role="menu"
            aria-label="Sisipkan data dari baris Excel"
            className="fixed z-[80] w-72 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl shadow-slate-900/15"
            style={{
              top: Math.max(8, Math.min(messageDataMenu.y, window.innerHeight - 320)),
              left: Math.max(8, Math.min(messageDataMenu.x, window.innerWidth - 296)),
            }}
          >
            <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-3">
              <div className="text-xs font-semibold">Sisipkan data baris ini</div>
              <div className="mt-1 text-[11px] text-slate-500">Pilih kolom untuk membuat personalisasi.</div>
            </div>
            <div className="flat-scrollbar max-h-64 overflow-y-auto p-1.5">
              {(() => {
                const row = rows.find((item) => item.id === messageDataMenu.rowId);
                const fields = Object.entries(row?.sourceData ?? {}).filter(([key]) => key.trim());
                if (!fields.length) {
                  return (
                    <p className="px-3 py-4 text-xs leading-5 text-slate-500">
                      Tidak ada kolom sumber Excel pada baris ini.
                    </p>
                  );
                }
                return fields.map(([key, value]) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-emerald-50 focus-visible:bg-emerald-50 focus-visible:outline-none"
                    onClick={() => insertMessageData(key)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{key}</span>
                      <span className="block truncate text-[11px] text-slate-500">{value || "Kosong pada baris ini"}</span>
                    </span>
                    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-1 font-mono text-[10px] text-emerald-800">
                      {"{{…}}"}
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </>
      )}
      <span className="sr-only" aria-live="polite">{clipboardText ? "Data siap disalin" : ""}</span>
    </div>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      variant="ghost"
      aria-current={active ? "page" : undefined}
      className={`h-11 w-full justify-start gap-3 px-3 text-left ${active ? "bg-emerald-700 text-white hover:bg-emerald-700 hover:text-white" : "text-emerald-100 hover:bg-white/10 hover:text-white"}`}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RowAction({ title, disabled, danger = false, onClick, children }: { title: string; disabled: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Button variant="ghost" size="icon" title={title} aria-label={title} disabled={disabled} onClick={onClick} className={danger ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : "text-muted-foreground"}>{children}</Button>;
}

function ColumnResizeHandle({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ubah lebar kolom"
      title="Seret untuk mengubah lebar • double-click batas untuk auto-fit kolom terpilih"
      className="column-resize-handle"
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    />
  );
}

function RowResizeHandle({
  onPointerDown,
  onDoubleClick,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Ubah tinggi baris"
      title="Seret untuk mengubah tinggi • double-click batas untuk auto-fit baris terpilih"
      className="row-resize-handle"
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    />
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "green" | "red" }) {
  const tones = {
    slate: "bg-slate-400",
    green: "bg-emerald-500",
    red: "bg-rose-500",
  } as const;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <span className={`size-1.5 rounded-full ${tones[tone]}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-800 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] text-slate-400">baris</div>
    </Card>
  );
}

function cellClass(selection: Selection | null, active: Cell | null, row: number, col: number) {
  const selected = isSelected(selection, row, col);
  const current = active?.row === row && active.col === col;
  return `relative overflow-hidden border-r border-slate-100 px-3 py-1 text-slate-700 ${selected ? "bg-emerald-50" : ""} ${current ? "outline outline-2 -outline-offset-2 outline-emerald-500" : ""}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function delayOrStop(milliseconds: number, stop: { current: boolean }) {
  let elapsed = 0;
  while (elapsed < milliseconds && !stop.current) {
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(200, milliseconds - elapsed)));
    elapsed += 200;
  }
  return stop.current;
}

function wrappedLineCount(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  if (!value) return 1;
  let lineCount = 0;
  for (const paragraph of value.split(/\r?\n/)) {
    if (!paragraph) {
      lineCount += 1;
      continue;
    }

    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) lineCount += 1;
      if (context.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }

      line = "";
      for (const character of word) {
        const next = line + character;
        if (line && context.measureText(next).width > maxWidth) {
          lineCount += 1;
          line = character;
        } else {
          line = next;
        }
      }
    }
    lineCount += 1;
  }
  return Math.max(1, lineCount);
}
