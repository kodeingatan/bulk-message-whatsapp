import path from "node:path";
import { dialog } from "electron";
import { attachmentExtensions, getAttachmentType } from "./attachment-types.js";

export async function selectAttachments(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Pilih berkas untuk pesan WhatsApp",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Berkas umum", extensions: attachmentExtensions }],
  });
  if (result.canceled) return { canceled: true };

  const attachments = result.filePaths.map((filePath) => {
    const type = attachmentTypes[path.extname(filePath).toLowerCase()];
    if (!type) throw new Error(`Jenis berkas tidak didukung: ${path.basename(filePath)}`);
    return { path: filePath, name: path.basename(filePath), ...type };
  });
  return { canceled: false, attachments };
}
