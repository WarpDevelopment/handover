import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, desktopCapturer, ipcMain, screen, type IpcMainEvent } from "electron";

import type { RecEvent } from "../../common/types";
import { ShotStore } from "../frames/shot-store";
import { createLogger } from "../logger";

const log = createLogger("Capture");
const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Result of a capture run. No video is recorded; `startEpoch` still anchors narration. */
export interface VideoResult {
  startEpoch: number;
  stopEpoch: number;
  durationMs: number;
  fps: number;
  displayIds: number[];
  /** Legacy fields read by the post-processing pipeline; absent for frame-ring capture. */
  framesFile?: string;
  frameCount?: number;
}

// Capture at native resolution up to 2,560 px wide, ~3 frames per second per display, JPEG q=0.9.
// Frames live in a ~2 s in-memory ring; only the frames a step needs reach the session folder.
const FPS = 3;
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 4320;
const JPEG_QUALITY = 0.9;
const REFRESH_MS = 1000;
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const SNAPSHOT_WAIT_MS = 400;
const MAX_FRAME_BYTES = 12 * 1024 * 1024;

interface ShotMessage {
  displayId: number;
  epoch: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Captures every display into an in-memory ring (hidden renderer: electron/video/capture-preload.cjs)
 * and persists the frames each step needs. Strictly best-effort: without a screen source or the
 * Screen Recording permission it logs and the session proceeds without frames.
 */
export class VideoRecorder {
  private win: BrowserWindow | null = null;
  private store: ShotStore | null = null;
  private startEpoch: number | null = null;
  private displayIds: number[] = [];
  private startedResolve: (() => void) | null = null;
  private stoppedResolve: (() => void) | null = null;

  private readonly onShot = (e: IpcMainEvent, shot: ShotMessage) => {
    if (e.sender !== this.win?.webContents || !this.store) return;
    if (
      !(shot?.data instanceof Uint8Array) ||
      shot.data.byteLength === 0 ||
      shot.data.byteLength > MAX_FRAME_BYTES ||
      !Number.isFinite(shot.epoch) ||
      !Number.isInteger(shot.displayId) ||
      !(shot.width > 0 && shot.width <= 16_384) ||
      !(shot.height > 0 && shot.height <= 16_384)
    ) {
      log.warn("ignored a captured frame with an invalid payload");
      return;
    }
    this.store.ingest({
      displayId: shot.displayId,
      epoch: Math.round(shot.epoch),
      width: shot.width,
      height: shot.height,
      data: shot.data,
    });
  };

  private readonly onSame = (e: IpcMainEvent, msg: { displayId: number; epoch: number }) => {
    if (e.sender !== this.win?.webContents || !this.store) return;
    if (Number.isInteger(msg?.displayId) && Number.isFinite(msg?.epoch)) {
      this.store.ingestSame(msg.displayId, Math.round(msg.epoch));
    }
  };

  private readonly onStarted = (e: IpcMainEvent, epoch: number, displayIds: number[]) => {
    if (e.sender !== this.win?.webContents) return;
    this.startEpoch = epoch;
    this.displayIds = Array.isArray(displayIds) ? displayIds.filter(Number.isInteger) : [];
    this.startedResolve?.();
    this.startedResolve = null;
    log.info("capturing displays", this.displayIds.join(","), "from epoch", epoch);
  };

  private readonly onStopped = (e: IpcMainEvent) => {
    if (e.sender === this.win?.webContents) this.stoppedResolve?.();
  };

  private readonly onError = (e: IpcMainEvent, message: string) => {
    if (e.sender !== this.win?.webContents) return;
    log.warn("capture unavailable:", message);
    this.startedResolve?.();
    this.startedResolve = null;
    this.stoppedResolve?.();
  };

  private readonly onDisplayError = (e: IpcMainEvent, displayId: number, message: string) => {
    if (e.sender === this.win?.webContents) log.warn(`display ${displayId} not captured:`, message);
  };

  /** Begin capturing every display. The legacy source arguments are ignored. Never throws. */
  async start(sessionDir: string, _sourceId?: string, _displayId?: string): Promise<void> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (sources.length === 0) {
        log.warn("no screen source available; continuing without frames");
        return;
      }
      const displays = screen.getAllDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      const mapped = sources.map((source, i) => {
        const parsed = Number.parseInt(source.display_id, 10);
        // Some platforms leave display_id empty; the sources then follow the display order.
        const displayId = Number.isInteger(parsed) ? parsed : (displays[i]?.id ?? primaryId);
        return { sourceId: source.id, displayId };
      });

      this.store = new ShotStore(sessionDir);
      this.startEpoch = null;
      this.displayIds = [];
      ipcMain.on("video:shot", this.onShot);
      ipcMain.on("video:same", this.onSame);
      ipcMain.on("video:started", this.onStarted);
      ipcMain.on("video:stopped", this.onStopped);
      ipcMain.on("video:error", this.onError);
      ipcMain.on("video:display-error", this.onDisplayError);

      this.win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(dirname, "video", "capture-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      await this.win.loadFile(path.join(dirname, "video", "capture.html"));

      const started = new Promise<void>((resolve) => {
        this.startedResolve = resolve;
      });
      this.win.webContents.send("video:start", {
        sources: mapped,
        fps: FPS,
        captureFps: 4,
        maxWidth: MAX_WIDTH,
        maxHeight: MAX_HEIGHT,
        jpegQuality: JPEG_QUALITY,
        refreshMs: REFRESH_MS,
      });
      log.info("capture requested for", mapped.length, "display(s)");
      await Promise.race([started, delay(START_TIMEOUT_MS)]);
      if (this.startEpoch == null) {
        log.warn("screen capture did not start; continuing without frames");
        await this.teardown();
      }
    } catch (err) {
      log.warn("failed to start capture:", err instanceof Error ? err.message : err);
      await this.teardown();
    }
  }

  /** Feed a recorded event: steps get their before frame, and an after frame ~500 ms later. */
  onEvent(ev: RecEvent): void {
    this.store?.onEvent(ev);
  }

  /** A forced frame of every display right now, persisted for a freeze (`purpose: annotation`). */
  async snapshot(force = true): Promise<Awaited<ReturnType<ShotStore["persistSnapshot"]>>> {
    if (!this.win || !this.store) return [];
    if (force) {
      this.win.webContents.send("video:snapshot");
      await delay(SNAPSHOT_WAIT_MS);
    }
    return this.store.persistSnapshot();
  }

  /** Stop capturing, persist the pending frames and return the result, or null if none ran. */
  async stop(): Promise<VideoResult | null> {
    if (!this.win || !this.store) {
      await this.teardown();
      return null;
    }
    const stopped = new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
      this.win?.webContents.send("video:stop");
    });
    await Promise.race([stopped, delay(STOP_TIMEOUT_MS)]);
    const stopEpoch = Date.now();
    const startEpoch = this.startEpoch;
    const displayIds = this.displayIds;
    try {
      await this.store.flush();
    } catch (err) {
      log.warn("could not write the captured frames:", err instanceof Error ? err.message : err);
    }
    const count = this.store.entries().length;
    await this.teardown();
    if (startEpoch == null) return null;
    log.info(`capture stopped: ${count} frame(s) kept for steps`);
    return {
      startEpoch,
      stopEpoch,
      durationMs: stopEpoch - startEpoch,
      fps: FPS,
      displayIds,
      frameCount: count,
    };
  }

  private async teardown(): Promise<void> {
    ipcMain.removeListener("video:shot", this.onShot);
    ipcMain.removeListener("video:same", this.onSame);
    ipcMain.removeListener("video:started", this.onStarted);
    ipcMain.removeListener("video:stopped", this.onStopped);
    ipcMain.removeListener("video:error", this.onError);
    ipcMain.removeListener("video:display-error", this.onDisplayError);
    this.stoppedResolve = null;
    this.startedResolve = null;
    this.store?.dispose();
    this.store = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
