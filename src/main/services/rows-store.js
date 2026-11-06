import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { MAX_IMPORT_ROWS } from "../../shared/constants.js";
import { sanitizeRow } from "../utils/rows.js";

export class RowsStore {
  constructor({ dataFile }) {
    this.dataFile = dataFile;
    this.rows = [];
    this.datasets = [];
    this.saveTimer = null;
    this.dirty = false;
  }

  load() {
    const stored = this.read();
    this.rows = stored.rows;
    this.datasets = stored.datasets;
    return this.getRows();
  }

  getRows() {
    return this.rows;
  }

  getDatasets() {
    return this.datasets;
  }

  saveDatasets(datasets) {
    if (!Array.isArray(datasets)) return { ok: false, error: "Data dataset tidak valid" };

    this.datasets = datasets.map((dataset) => ({
      id: String(dataset?.id ?? randomUUID()),
      name: String(dataset?.name ?? "Data Excel"),
      sheet: String(dataset?.sheet ?? ""),
      source: dataset?.source === "manual" ? "manual" : "excel",
      rows: Array.isArray(dataset?.rows)
        ? dataset.rows.slice(0, MAX_IMPORT_ROWS).map(sanitizeRow)
        : [],
    }));
    this.rows = this.datasets[0]?.rows ?? [];
    this.dirty = true;
    this.scheduleSave();
    return { ok: true };
  }

  save(rows) {
    if (!Array.isArray(rows)) return { ok: false, error: "Data tidak valid" };

    this.rows = rows.slice(0, MAX_IMPORT_ROWS).map(sanitizeRow);
    this.dirty = true;
    this.scheduleSave();
    return { ok: true };
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.writeNow();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), 350);
  }

  writeNow() {
    if (!this.dataFile || !this.dirty) return;

    try {
      const payload = JSON.stringify({
        updatedAt: new Date().toISOString(),
        rows: this.rows,
        datasets: this.datasets,
      }, null, 2);
      const tmp = `${this.dataFile}.tmp`;
      fs.writeFileSync(tmp, payload, "utf8");
      fs.renameSync(tmp, this.dataFile);
      this.dirty = false;
    } catch (error) {
      console.error("Gagal menyimpan data:", error?.message || error);
    }
  }

  read() {
    try {
      if (!this.dataFile || !fs.existsSync(this.dataFile)) return { rows: [], datasets: [] };
      const parsed = JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
      const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
      const datasets = Array.isArray(parsed?.datasets)
        ? parsed.datasets.map((dataset) => ({
            id: String(dataset?.id ?? randomUUID()),
            name: String(dataset?.name ?? "Data Excel"),
            sheet: String(dataset?.sheet ?? ""),
            source: dataset?.source === "manual" ? "manual" : "excel",
            rows: Array.isArray(dataset?.rows)
              ? dataset.rows.slice(0, MAX_IMPORT_ROWS).map(sanitizeRow)
              : [],
          }))
        : Array.isArray(rows) && rows.length
          ? [{ id: "legacy-data", name: "Data saat ini", sheet: "", rows: rows.slice(0, MAX_IMPORT_ROWS).map(sanitizeRow) }]
          : [];
      return {
        rows: Array.isArray(rows) ? rows.map(sanitizeRow) : [],
        datasets,
      };
    } catch {
      return { rows: [], datasets: [] };
    }
  }
}
