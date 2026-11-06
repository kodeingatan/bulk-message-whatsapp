export type RowStatus = "pending" | "sending" | "sent" | "failed";
export type WAConnection =
  | "idle"
  | "connecting"
  | "qr"
  | "open"
  | "closed"
  | "logged_out"
  | "error";

export interface ContactRow {
  id: string;
  phone: string;
  recipient: string;
  message: string;
  status: RowStatus;
  sentAt: string;
  error: string;
  sourceData?: Record<string, string>;
}

export interface MessageDataset {
  id: string;
  name: string;
  sheet: string;
  source?: "excel" | "manual";
  rows: ContactRow[];
}

export interface WhatsAppState {
  connection: WAConnection;
  qr: string | null;
  me: string | null;
  message: string;
}

export interface ImportResult {
  canceled?: boolean;
  error?: string;
  importId?: string;
  sheetNames?: string[];
  rows?: ContactRow[];
  sheet?: string;
  fileName?: string;
  truncated?: boolean;
}

export interface OperationResult {
  ok: boolean;
  error?: string;
}

export interface ExportResult {
  canceled?: boolean;
  error?: string;
  filePath?: string;
}

export interface BulkWAAPI {
  connect(): Promise<WhatsAppState>;
  status(): Promise<WhatsAppState>;
  logout(): Promise<WhatsAppState>;
  reset(): Promise<WhatsAppState>;
  send(payload: { phone: string; message: string }): Promise<OperationResult>;
  loadRows(): Promise<{ rows: ContactRow[] }>;
  saveRows(rows: ContactRow[]): Promise<OperationResult>;
  loadDatasets(): Promise<{ datasets: MessageDataset[] }>;
  saveDatasets(datasets: MessageDataset[]): Promise<OperationResult>;
  selectImportFile(): Promise<ImportResult>;
  importSheet(importId: string, sheetName: string): Promise<ImportResult>;
  exportRows(rows: ContactRow[], sheetName: string): Promise<ExportResult>;
  copyText(text: string): void;
  onWAEvent(callback: (event: WhatsAppState & { type: "state" }) => void): () => void;
}

declare global {
  interface Window {
    bulkWA: BulkWAAPI;
  }
}
