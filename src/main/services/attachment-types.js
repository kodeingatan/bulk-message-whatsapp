import path from "node:path";

export const attachmentTypes = {
  ".png": { mimeType: "image/png", kind: "image" },
  ".jpg": { mimeType: "image/jpeg", kind: "image" },
  ".jpeg": { mimeType: "image/jpeg", kind: "image" },
  ".gif": { mimeType: "image/gif", kind: "image" },
  ".webp": { mimeType: "image/webp", kind: "image" },
  ".mp4": { mimeType: "video/mp4", kind: "video" },
  ".3gp": { mimeType: "video/3gpp", kind: "video" },
  ".mov": { mimeType: "video/quicktime", kind: "video" },
  ".mp3": { mimeType: "audio/mpeg", kind: "audio" },
  ".m4a": { mimeType: "audio/mp4", kind: "audio" },
  ".ogg": { mimeType: "audio/ogg", kind: "audio" },
  ".opus": { mimeType: "audio/ogg; codecs=opus", kind: "audio" },
  ".wav": { mimeType: "audio/wav", kind: "audio" },
  ".pdf": { mimeType: "application/pdf", kind: "document" },
  ".doc": { mimeType: "application/msword", kind: "document" },
  ".docx": { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  ".xls": { mimeType: "application/vnd.ms-excel", kind: "document" },
  ".xlsx": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" },
  ".ppt": { mimeType: "application/vnd.ms-powerpoint", kind: "document" },
  ".pptx": { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document" },
  ".txt": { mimeType: "text/plain", kind: "document" },
  ".csv": { mimeType: "text/csv", kind: "document" },
};

export const attachmentExtensions = Object.keys(attachmentTypes).map((extension) => extension.slice(1));

export function getAttachmentType(filePath) {
  return attachmentTypes[path.extname(String(filePath ?? "")).toLowerCase()] ?? null;
}
