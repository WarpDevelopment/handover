// Headless stand-in for the `electron` module so app code can run under plain
// Node in the unit tests. The only real dependency in that code path is
// `app.getPath` inside session-store.ts, and the tests override the sessions
// root via HANDOVER_SESSIONS_DIR — so getPath is never actually called.
// Everything else is a benign no-op provided only to satisfy static
// `import { … } from "electron"` links in modules that might get pulled in.
import os from "node:os";
import path from "node:path";

const notAvailable = (name) => () => {
  throw new Error(`electron.${name} is not available in the headless test runtime`);
};

export const app = {
  getPath: (name) => path.join(os.tmpdir(), "handover-test", String(name ?? "userData")),
  getVersion: () => "0.0.0-test",
  getName: () => "handover-test",
  getAppPath: () => process.cwd(),
  on: () => app,
  whenReady: () => Promise.resolve(),
  quit: () => undefined,
};

export const ipcMain = { handle: () => undefined, on: () => undefined, removeHandler: () => undefined };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  getSelectedStorageBackend: () => "unknown",
  encryptString: notAvailable("safeStorage.encryptString"),
  decryptString: notAvailable("safeStorage.decryptString"),
};
export const globalShortcut = { register: () => false, unregisterAll: () => undefined };
export const clipboard = { readText: () => "", readImage: () => ({ isEmpty: () => true }), availableFormats: () => [] };
export const screen = { getPrimaryDisplay: notAvailable("screen.getPrimaryDisplay"), getDisplayMatching: notAvailable("screen.getDisplayMatching") };
export const desktopCapturer = { getSources: async () => [] };
export const nativeImage = { createEmpty: () => ({ isEmpty: () => true }), createFromPath: () => ({ isEmpty: () => true }) };

export class BrowserWindow {
  constructor() { throw new Error("electron.BrowserWindow is not available in the headless test runtime"); }
}
export class Menu {}
export class Tray {
  constructor() { throw new Error("electron.Tray is not available in the headless test runtime"); }
}

export default { app, ipcMain, globalShortcut, clipboard, screen, desktopCapturer, nativeImage, BrowserWindow, Menu, Tray };
