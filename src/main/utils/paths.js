import path from "node:path";
import { app } from "electron";

const AUTH_DIR_NAME = "auth_info";
const DATA_FILE_NAME = "bulk-whatsapp-data.json";
const RESPONSES_DIR_NAME = "wa-responses";
const RESPONSES_SETTINGS_FILE_NAME = "wa-response-settings.json";

export function getAppPaths() {
  const userData = app.getPath("userData");
  return {
    userData,
    authDir: app.isPackaged
      ? path.join(userData, AUTH_DIR_NAME)
      : path.join(app.getAppPath(), AUTH_DIR_NAME),
    dataFile: path.join(userData, DATA_FILE_NAME),
    responsesDir: path.join(userData, RESPONSES_DIR_NAME),
    responsesSettingsFile: path.join(userData, RESPONSES_SETTINGS_FILE_NAME),
  };
}
