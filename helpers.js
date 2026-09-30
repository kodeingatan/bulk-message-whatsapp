import { openWindowsFileDialog } from "open-windows-file-dialog";
import XLSX from "xlsx";

export function parseJSON(str) {
    // Ensure the input is a non-empty string first
    if (typeof str !== 'string' || !str.trim()) {
        return null;
    }

    try {
        const parsed = JSON.parse(str);

        // Ensure the output is a structured object or array, not a primitive
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch (e) {
        return null;
    }
}

export async function handleFileOpen(config = {}) {
    const result = await openWindowsFileDialog(undefined, config);
    return result?.files?.[0];
}

export function getFileExcelData(filePath) {
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets["WHATSAPPS"];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
}