import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

import type { CaptureConfig } from "../../common/config";
import { EventType } from "../../common/events";
import type { DisplaysPayload, PointerClickPayload, TerminalCommandPayload } from "../../common/events";
import { layoutChanged } from "../../common/handover/displays";
import { sanitizeExplainResult } from "../../common/handover/explain";
import { HELPER_FILE } from "../../common/handover/helper";
import type { HelperStatus } from "../../common/handover/types";
import type {
  DiscardResult,
  MarkerResult,
  MicrophoneResult,
  NarrationLanguageResult,
  RecorderStatus,
  StartOptions,
  StartResult,
  StopResult,
} from "../../common/ipc";
import {
  DEFAULT_NARRATION_LANGUAGE,
  isNarrationLanguage,
  type NarrationLanguage,
} from "../../common/narration";
import type { RecEvent, RecorderState, SessionMeta } from "../../common/types";
import { isOwnAppEvent } from "./own-events";
import {
  SYSTEM_DEFAULT_MICROPHONE_ID,
  type MicrophoneDevice,
} from "../../common/microphone";
import { createLogger } from "../logger";
import type { Collector } from "./collector";
import { CollectorHost } from "./collector";
import { EventBus } from "./event-bus";
import { SessionStore } from "./session-store";

const log = createLogger("Recorder");

function makeSessionId(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

/** A best-effort screen-video sidecar tied to a session's lifecycle. */
export interface SessionVideoRecorder {
  start(
    sessionDir: string,
    sourceId?: string,
    displayId?: string,
  ): Promise<void>;
  stop(): Promise<unknown>;
  /** Every recorded event, so the sidecar can keep the frames a step needs. */
  onEvent?(ev: RecEvent): void;
  /** A forced frame of every display, saved in the session folder, for the Explain freeze. */
  snapshot?(force?: boolean): Promise<FrozenFrame[]>;
}

/** One frozen frame saved for an Explain freeze (`ShotEntry` with `purpose: "annotation"`). */
export interface FrozenFrame {
  /** Path relative to the session folder, e.g. `shots/000012.jpg`. */
  file: string;
  /** Electron `Display.id` the frame shows. */
  displayId: number;
  epoch: number;
}

export interface PauseResult {
  ok: boolean;
  error?: string;
}

export interface BeginExplainResult {
  ok: boolean;
  error?: string;
  /** The session folder the frozen frames are in. */
  sessionDir?: string;
  frames?: FrozenFrame[];
}

export interface EndExplainResult {
  ok: boolean;
  error?: string;
  /** Ids of the annotation events written. */
  annotationIds?: string[];
}

/** Microphone sidecar that can create multiple capture intervals per session. */
export interface SessionAudioRecorder {
  start(
    sessionDir: string,
    sessionStartedAt: number,
    narrationLanguage: NarrationLanguage,
  ): Promise<void>;
  enable(deviceId?: string): Promise<MicrophoneDevice | void>;
  disable(): Promise<unknown>;
  finish(videoStartEpoch: number | null): Promise<unknown>;
}

export interface AudioCaptureEnded {
  error: string | null;
}

export interface RecorderDeps {
  /** Resolves the capture config in effect for the next session. */
  resolveConfig: () => CaptureConfig;
  /** Builds the collectors enabled by a config. */
  buildCollectors: (config: CaptureConfig) => readonly Collector[];
  /** Optional factory for the video sidecar; only used when `config.video`. */
  createVideoRecorder?: () => SessionVideoRecorder;
  /** Optional factory for the live-toggle microphone sidecar. */
  createAudioRecorder?: (
    onCaptureEnded: (event: AudioCaptureEnded) => void,
  ) => SessionAudioRecorder;
  /** Permanently removes a finalized session when the user discards it. */
  deleteSession?: (sessionId: string) => Promise<void>;
  /** Optional best-effort post-processing (frames + correlation) after save. */
  postProcess?: (sessionDir: string) => Promise<void>;
  /** Current recorded-terminal activity, used to guard stop/discard. */
  terminalBusy?: () => { busy: boolean; command: string | null };
  /** Flush and close the recorded terminal before the event stream is finalized. */
  finishTerminal?: () => Promise<void>;
  /** The current display layout, recorded as a `displays` event at start and on changes. */
  getDisplays?: () => DisplaysPayload | null;
  /** The native helper's status when a recording stops, saved as `helper.json`. */
  getHelperStatus?: () => HelperStatus;
  /** The freeze was closed by the recorder (the recording stopped while frozen): close the overlay. */
  onExplainAborted?: () => void;
  /**
   * True when a click landed on Handover's own recording bar. Such a click is never recorded, so
   * pressing Explain, Pause or Resume does not become a step (or take the freeze's annotations).
   */
  isOwnWindowClick?: (click: PointerClickPayload) => boolean;
  /** The Electron id of the display under the pointer, recorded on `explain.start`. */
  pointerDisplayId?: () => number | undefined;
}

type FinishIntent = "save" | "discard";
type FinishResult = StopResult & DiscardResult;

/**
 * The recorder state machine. All lifecycle mutations are serialized so UI,
 * tray, shortcut, microphone, and app-shutdown commands cannot race each other.
 */
export class RecorderController {
  private store: SessionStore | null = null;
  private readonly listeners = new Set<(status: RecorderStatus) => void>();
  private readonly bus = new EventBus();
  private readonly host: CollectorHost;
  private activeCollectors: readonly Collector[] = [];
  private video: SessionVideoRecorder | null = null;
  private videoUnsubscribe: (() => void) | null = null;
  private lastDisplays: DisplaysPayload | null = null;
  private lastDisplaysEvent: RecEvent | null = null;
  private audio: SessionAudioRecorder | null = null;
  private transition: RecorderStatus["transition"] = "none";
  private narrationLanguage = DEFAULT_NARRATION_LANGUAGE;
  private microphone: RecorderStatus["microphone"] = {
    state: "off",
    error: null,
    activeDevice: null,
  };
  private lastFinish: RecorderStatus["lastFinish"] = null;
  private shuttingDown = false;
  private operations: Promise<void> = Promise.resolve();
  private readonly processing = new Set<Promise<void>>();
  private lastCompleted: { id: string; dir: string } | null = null;
  private lastProcessed = false;
  private paused = false;
  private explain: { frames: FrozenFrame[]; displaySizes: Map<number, [number, number]> } | null = null;
  private annotationCounter = 0;

  constructor(private readonly deps: RecorderDeps) {
    this.host = new CollectorHost(this.bus);
    this.bus.setFilter((input) => {
      if (input.type === EventType.PointerClick) return this.deps.isOwnWindowClick?.(input.payload) ?? false;
      return isOwnAppEvent(input);
    });
    // Every persisted event refreshes live status (event count, etc.).
    this.bus.subscribe(() => this.emit());
  }

  get state(): RecorderState {
    return this.store ? "recording" : "idle";
  }

  /** The last completed session's directory, if any (for analysis). */
  lastSessionDir(): string | null {
    return this.lastCompleted?.dir ?? null;
  }

  activeSession(): { id: string; dir: string; startedAt: number } | null {
    const store = this.store;
    return store
      ? { id: store.meta.id, dir: store.dir, startedAt: store.meta.startedAt }
      : null;
  }

  /**
   * Record the display layout as a `displays` event when it differs from the last one recorded.
   * Called at session start and on every display change; a no-op while idle.
   */
  publishDisplays(): void {
    if (!this.store || !this.deps.getDisplays) return;
    const layout = this.deps.getDisplays();
    if (!layout || !layoutChanged(this.lastDisplays, layout)) return;
    const ev = this.bus.publish({ type: EventType.Displays, source: "screen", payload: layout });
    if (!ev) return;
    this.lastDisplays = layout;
    this.lastDisplaysEvent = ev;
  }

  /** Save the native helper's status next to the events, for the package manifest. Best effort. */
  private writeHelperStatus(dir: string): void {
    if (!this.deps.getHelperStatus) return;
    try {
      writeFileSync(path.join(dir, HELPER_FILE), JSON.stringify(this.deps.getHelperStatus(), null, 2));
    } catch (error) {
      log.warn("could not write helper status:", error instanceof Error ? error.message : error);
    }
  }

  private releaseVideoFeed(): void {
    this.videoUnsubscribe?.();
    this.videoUnsubscribe = null;
  }

  recordTerminalCommand(payload: TerminalCommandPayload): boolean {
    if (!this.store) return false;
    this.bus.publish({
      type: EventType.TerminalCommand,
      source: "recorded-terminal",
      payload,
    });
    return true;
  }

  /**
   * Forget a session if it's the one being tracked as "last completed" — called
   * after a session is deleted, so status()/analyze no longer point at a dir that
   * no longer exists. No-op for any other id.
   */
  forgetSession(id: string): void {
    if (this.lastCompleted?.id !== id) return;
    this.lastCompleted = null;
    this.lastProcessed = false;
    if (this.lastFinish?.sessionId === id) this.lastFinish = null;
    this.emit();
  }

  status(): RecorderStatus {
    return {
      state: this.state,
      sessionId: this.store?.meta.id ?? null,
      startedAt: this.store?.meta.startedAt ?? null,
      narrationLanguage: this.narrationLanguage,
      eventCount: this.store?.eventCount ?? 0,
      paused: this.paused,
      explaining: this.explain !== null,
      transition: this.transition,
      microphone: {
        ...this.microphone,
        activeDevice: this.microphone.activeDevice
          ? { ...this.microphone.activeDevice }
          : null,
      },
      lastFinish: this.lastFinish ? { ...this.lastFinish } : null,
      lastSession: this.lastCompleted
        ? { id: this.lastCompleted.id, processed: this.lastProcessed }
        : null,
    };
  }

  onStatusChanged(cb: (status: RecorderStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  start(options?: StartOptions): Promise<StartResult> {
    return this.enqueue(() =>
      this.shuttingDown
        ? Promise.resolve({ ok: false, error: "Handover is shutting down." })
        : this.startInternal(options),
    );
  }

  stop(forceTerminal = false): Promise<StopResult> {
    return this.enqueue(() => this.finish("save", forceTerminal));
  }

  discard(forceTerminal = false): Promise<DiscardResult> {
    return this.enqueue(() => this.finish("discard", forceTerminal));
  }

  setMicrophoneEnabled(
    enabled: boolean,
    deviceId = SYSTEM_DEFAULT_MICROPHONE_ID,
  ): Promise<MicrophoneResult> {
    return this.enqueue(async () => {
      if (!this.store || this.transition !== "none") {
        return { ok: false, error: "Microphone controls are only available while recording." };
      }
      return this.setMicrophoneInternal(enabled, deviceId);
    });
  }

  setMicrophoneDevice(deviceId: string): Promise<MicrophoneResult> {
    return this.enqueue(async () => {
      if (!this.store || this.transition !== "none") {
        return { ok: false, error: "Microphone controls are only available while recording." };
      }
      if (this.microphone.state !== "on") {
        return { ok: true, state: this.microphone.state };
      }
      if (!this.audio) {
        const error = "Microphone capture is unavailable for this recording.";
        this.microphone = { state: "error", error, activeDevice: null };
        this.emit();
        return { ok: false, state: "error", error };
      }

      this.microphone = {
        state: "stopping",
        error: null,
        activeDevice: this.microphone.activeDevice,
      };
      this.emit();
      try {
        await this.audio.disable();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.microphone = { state: "error", error: message, activeDevice: null };
        this.emit();
        return { ok: false, state: "error", error: message };
      }

      this.microphone = { state: "starting", error: null, activeDevice: null };
      this.emit();
      try {
        const result = await this.audio.enable(deviceId);
        this.microphone = {
          state: "on",
          error: null,
          activeDevice: isMicrophoneDevice(result) ? result : null,
        };
        this.emit();
        return { ok: true, state: "on" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.microphone = { state: "error", error: message, activeDevice: null };
        this.emit();
        return { ok: false, state: "error", error: message };
      }
    });
  }

  setNarrationLanguage(language: NarrationLanguage): Promise<NarrationLanguageResult> {
    return this.enqueue(async () => {
      if (this.store || this.transition !== "none") {
        return {
          ok: false,
          error: "Narration language cannot change while recording.",
        };
      }
      if (!isNarrationLanguage(language)) {
        return { ok: false, error: "Unsupported narration language." };
      }
      this.narrationLanguage = language;
      this.emit();
      return { ok: true, language };
    });
  }

  /**
   * Pause the recording. Writes `gap{user_paused}` (open: no `tEndMs`) and drops every collector
   * event until {@link resume}. Screen capture keeps running, so the frame ring stays warm.
   */
  pause(): Promise<PauseResult> {
    return this.enqueue(async () => {
      if (!this.store || this.transition !== "none") return { ok: false, error: "Not recording" };
      if (this.paused) return { ok: true };
      if (this.explain) return { ok: false, error: "Finish the Explain step before pausing." };
      this.bus.publish({ type: EventType.Gap, source: "user", payload: { reason: "user_paused" } });
      this.paused = true;
      this.bus.setBlocked(true);
      this.emit();
      return { ok: true };
    });
  }

  /** Resume after {@link pause}: closes the open gap with `tEndMs`. */
  resume(): Promise<PauseResult> {
    return this.enqueue(async () => {
      if (!this.store || this.transition !== "none") return { ok: false, error: "Not recording" };
      if (!this.paused) return { ok: true };
      this.closePauseGap(this.store);
      this.emit();
      return { ok: true };
    });
  }

  private closePauseGap(store: SessionStore): void {
    this.paused = false;
    this.bus.setBlocked(this.explain !== null);
    this.bus.publish({
      type: EventType.Gap,
      source: "user",
      payload: { reason: "user_paused", tEndMs: Math.round(store.elapsedMs()) },
    });
  }

  /**
   * Freeze the screen for an explanation: takes one frozen frame per display, writes
   * `explain.start`, and drops collector events until {@link endExplain}. The caller opens the
   * overlay windows from the returned frames.
   */
  beginExplain(): Promise<BeginExplainResult> {
    return this.enqueue(async () => {
      const store = this.store;
      if (!store || this.transition !== "none") return { ok: false, error: "Not recording" };
      if (this.paused) return { ok: false, error: "Resume the recording before explaining something." };
      if (this.explain) return { ok: false, error: "The screen is already frozen." };
      let frames: FrozenFrame[] = [];
      try {
        frames = (await this.video?.snapshot?.(true)) ?? [];
      } catch (error) {
        log.warn("freeze snapshot failed:", error instanceof Error ? error.message : error);
      }
      if (frames.length === 0) {
        return { ok: false, error: "Screen capture is not available, so the screen cannot be frozen." };
      }
      // The recording may have stopped while the snapshot was taken.
      if (this.store !== store || this.transition !== "none") return { ok: false, error: "Not recording" };
      const displaySizes = new Map<number, [number, number]>();
      for (const d of this.lastDisplays?.displays ?? []) displaySizes.set(d.id, d.sizeDpx);
      const pointer = this.deps.pointerDisplayId?.();
      this.bus.publish({
        type: EventType.ExplainStart,
        source: "user",
        payload: {
          displayIds: frames.map((f) => f.displayId),
          ...(pointer !== undefined ? { pointerDisplayId: pointer } : {}),
        },
      });
      this.explain = { frames, displaySizes };
      this.bus.setBlocked(true);
      this.emit();
      return { ok: true, sessionDir: store.dir, frames };
    });
  }

  /**
   * End the freeze. `result` is what the overlay returned; it is validated here. Highlights and
   * comments become `annotation` events, then `explain.end` is written. A cancelled result writes
   * only `explain.end`: the time was still spent explaining.
   */
  endExplain(result: unknown): Promise<EndExplainResult> {
    return this.enqueue(async () => this.endExplainInternal(result));
  }

  private endExplainInternal(raw: unknown): EndExplainResult {
    const ex = this.explain;
    if (!ex || !this.store) return { ok: false, error: "The screen is not frozen." };
    const result = sanitizeExplainResult(raw, ex.displaySizes);
    const ids: string[] = [];
    for (const a of result.annotations) {
      const annotationId = `ann_${String(++this.annotationCounter).padStart(4, "0")}`;
      if (a.kind === "comment") {
        this.bus.publish({
          type: EventType.Annotation,
          source: "freeze",
          payload: { annotationId, kind: "comment", text: a.text, source: "typed" },
        });
      } else {
        const frame = ex.frames.find((f) => f.displayId === a.displayId);
        this.bus.publish({
          type: EventType.Annotation,
          source: "freeze",
          payload: {
            annotationId,
            kind: "highlight",
            displayId: a.displayId,
            ...(frame ? { frameFile: frame.file } : {}),
            shape: a.shape,
            pointsDpx: a.pointsDpx,
          },
        });
      }
      ids.push(annotationId);
    }
    this.bus.publish({
      type: EventType.ExplainEnd,
      source: "user",
      payload: { displayIds: ex.frames.map((f) => f.displayId) },
    });
    this.explain = null;
    this.bus.setBlocked(this.paused);
    this.emit();
    return { ok: true, annotationIds: ids };
  }

  // Marker capture is intentionally retained even though the "Add marker" HUD
  // button was removed in favor of voice narration (see docs/future-features.md).
  marker(note: string): MarkerResult {
    if (!this.store || this.transition !== "none") {
      return { ok: false, error: "Not recording" };
    }
    this.bus.publish({ type: EventType.Marker, source: "user", payload: { note } });
    return { ok: true };
  }

  /** Resolves when every saved session still being post-processed has finished. */
  whenProcessed(): Promise<void> {
    return Promise.all([...this.processing]).then(() => undefined);
  }

  /** Reject new recordings while the app drains capture and post-processing. */
  beginShutdown(): void {
    this.shuttingDown = true;
  }

  private async startInternal(options?: StartOptions): Promise<StartResult> {
    if (this.store) return { ok: false, error: "Already recording" };
    if (
      options?.narrationLanguage !== undefined &&
      !isNarrationLanguage(options.narrationLanguage)
    ) {
      return { ok: false, error: "Unsupported narration language." };
    }
    if (options?.narrationLanguage !== undefined) {
      this.narrationLanguage = options.narrationLanguage;
    }

    this.transition = "starting";
    this.microphone = { state: "off", error: null, activeDevice: null };
    this.lastFinish = null;
    this.emit();

    let store: SessionStore;
    try {
      const meta: SessionMeta = {
        id: makeSessionId(),
        startedAt: Date.now(),
        stoppedAt: null,
        platform: process.platform,
        appVersion: app.getVersion(),
      };
      store = new SessionStore(meta);
    } catch (error) {
      this.transition = "none";
      this.emit();
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    this.store = store;
    this.bus.attach(store);
    this.paused = false;
    this.explain = null;
    this.annotationCounter = 0;
    this.bus.publish({
      type: EventType.SessionStart,
      source: "recorder",
      payload: { platform: store.meta.platform },
    });
    this.lastDisplays = null;
    this.lastDisplaysEvent = null;
    this.publishDisplays();
    log.info("Recording started:", store.meta.id); // the id only: the folder path names the OS user (SEC-8)
    this.emit();

    try {
      const config = this.deps.resolveConfig();
      this.activeCollectors = this.deps.buildCollectors(config);
      await this.host.startAll(this.activeCollectors, store.dir);

      // Video remains a best-effort sidecar; it never blocks the event recording.
      if (config.video && this.deps.createVideoRecorder) {
        this.video = this.deps.createVideoRecorder();
        try {
          await this.video.start(
            store.dir,
            options?.screenSourceId,
            options?.screenDisplayId,
          );
          const video = this.video;
          if (video.onEvent) {
            // The sidecar learns the layout first, then sees every later event.
            if (this.lastDisplaysEvent) video.onEvent(this.lastDisplaysEvent);
            this.videoUnsubscribe = this.bus.subscribe((ev) => {
              // A click now reaches the log while paused or frozen (PKG-11), but it must not take
              // before/after frames of the screen: the user paused so nothing would be captured.
              if (ev.type === EventType.PointerClick && (this.paused || this.explain !== null)) return;
              video.onEvent?.(ev);
            });
          }
        } catch (error) {
          log.warn("video start failed:", error instanceof Error ? error.message : error);
          this.video = null;
        }
      }

      // Initialize the audio utility for every session so the overlay can turn the
      // mic on later. This does not request microphone access until enable().
      if (this.deps.createAudioRecorder) {
        this.audio = this.deps.createAudioRecorder((event) => this.onAudioCaptureEnded(event));
        try {
          await this.audio.start(store.dir, store.meta.startedAt, this.narrationLanguage);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn("microphone initialization failed:", message);
          this.audio = null;
          this.microphone = { state: "error", error: message, activeDevice: null };
        }
      }

      if (options?.narration && this.audio) {
        await this.setMicrophoneInternal(
          true,
          options.microphoneDeviceId ?? SYSTEM_DEFAULT_MICROPHONE_ID,
        );
      }
    } catch (error) {
      // Startup failed after the store was attached; roll back to idle instead of
      // wedging the machine in "starting" (which would reject every later start()).
      const message = error instanceof Error ? error.message : String(error);
      log.warn("recording startup failed:", message);
      await this.rollbackFailedStart(store);
      return { ok: false, error: message };
    }

    this.transition = "none";
    this.emit();
    return { ok: true, sessionId: store.meta.id };
  }

  /**
   * Best-effort teardown when startInternal() throws after the store is attached.
   * Releases every producer and the event stream, then resets the machine to idle
   * so a subsequent start() can succeed.
   */
  private async rollbackFailedStart(store: SessionStore): Promise<void> {
    try {
      await this.host.stopAll();
    } catch (error) {
      log.warn("collector rollback failed:", error instanceof Error ? error.message : error);
    }
    this.releaseVideoFeed();
    if (this.video) {
      try {
        await this.video.stop();
      } catch (error) {
        log.warn("video rollback failed:", error instanceof Error ? error.message : error);
      }
      this.video = null;
    }
    if (this.audio) {
      try {
        await this.audio.disable();
      } catch (error) {
        log.warn("microphone rollback failed:", error instanceof Error ? error.message : error);
      }
      this.audio = null;
    }
    this.bus.detach();
    try {
      store.finalize(Date.now());
    } catch (error) {
      log.warn(
        "session cleanup after failed start failed:",
        error instanceof Error ? error.message : error,
      );
      store.dispose();
    }
    this.store = null;
    this.activeCollectors = [];
    this.microphone = { state: "off", error: null, activeDevice: null };
    this.transition = "none";
    this.emit();
  }

  private async setMicrophoneInternal(
    enabled: boolean,
    deviceId = SYSTEM_DEFAULT_MICROPHONE_ID,
  ): Promise<MicrophoneResult> {
    if (enabled) {
      if (this.microphone.state === "on") return { ok: true, state: "on" };
      if (!this.audio) {
        const error = "Microphone capture is unavailable for this recording.";
        this.microphone = { state: "error", error, activeDevice: null };
        this.emit();
        return { ok: false, state: "error", error };
      }

      this.microphone = { state: "starting", error: null, activeDevice: null };
      this.emit();
      try {
        const result = await this.audio.enable(deviceId);
        this.microphone = {
          state: "on",
          error: null,
          activeDevice: isMicrophoneDevice(result) ? result : null,
        };
        this.emit();
        return { ok: true, state: "on" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.microphone = { state: "error", error: message, activeDevice: null };
        this.emit();
        return { ok: false, state: "error", error: message };
      }
    }

    if (this.microphone.state === "off") return { ok: true, state: "off" };
    if (!this.audio) {
      this.microphone = { state: "off", error: null, activeDevice: null };
      this.emit();
      return { ok: true, state: "off" };
    }

    this.microphone = {
      state: "stopping",
      error: null,
      activeDevice: this.microphone.activeDevice,
    };
    this.emit();
    try {
      await this.audio.disable();
      this.microphone = { state: "off", error: null, activeDevice: null };
      this.emit();
      return { ok: true, state: "off" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.microphone = { state: "error", error: message, activeDevice: null };
      this.emit();
      return { ok: false, state: "error", error: message };
    }
  }

  private async finish(
    intent: FinishIntent,
    forceTerminal = false,
  ): Promise<FinishResult> {
    const store = this.store;
    if (!store) return { ok: false, error: "Not recording" };
    const terminal = this.deps.terminalBusy?.();
    if (terminal?.busy && !forceTerminal) {
      return {
        ok: false,
        requiresTerminalConfirmation: true,
        terminalCommand: terminal.command ?? undefined,
      };
    }

    const previousMicrophone = this.microphone;
    this.transition = intent === "save" ? "stopping" : "discarding";
    if (this.microphone.state !== "off") {
      this.microphone = {
        state: "stopping",
        error: null,
        activeDevice: this.microphone.activeDevice,
      };
    }
    this.emit();

    // Stop producers before finalizing the event stream. The terminal goes first
    // so its final command event can still be persisted to the attached event bus.
    if (this.deps.finishTerminal) {
      try {
        await this.deps.finishTerminal();
      } catch (error) {
        const terminalError = error instanceof Error ? error.message : String(error);
        this.transition = "none";
        this.microphone = previousMicrophone;
        this.emit();
        log.warn("terminal stop failed:", terminalError);
        return {
          ok: false,
          error: `Could not finalize the recorded terminal: ${terminalError}`,
        };
      }
    }
    // A recording stopped while paused or frozen closes both, so the time sums stay exact.
    if (this.explain) {
      this.endExplainInternal({ cancelled: true });
      this.deps.onExplainAborted?.();
    }
    if (this.paused) this.closePauseGap(store);
    // Audio is flushed before
    // video so the mic-off boundary is anchored as close as possible to the click.
    try {
      await this.host.stopAll();
    } catch (error) {
      log.warn("collector stop failed:", error instanceof Error ? error.message : error);
    }
    if (this.audio) {
      try {
        await this.audio.disable();
      } catch (error) {
        log.warn("microphone stop failed:", error instanceof Error ? error.message : error);
      }
    }

    let videoStartEpoch: number | null = null;
    this.releaseVideoFeed();
    if (this.video) {
      try {
        const result = await this.video.stop();
        videoStartEpoch = readStartEpoch(result);
      } catch (error) {
        log.warn("video stop failed:", error instanceof Error ? error.message : error);
      }
      this.video = null;
    }

    if (this.audio) {
      try {
        await this.audio.finish(videoStartEpoch);
      } catch (error) {
        log.warn("microphone finalization failed:", error instanceof Error ? error.message : error);
      }
      this.audio = null;
    }

    this.bus.publish({ type: EventType.SessionStop, source: "recorder", payload: {} });
    this.bus.detach();
    this.writeHelperStatus(store.dir);
    // A finalize failure (disk full, session dir removed) must not wedge the state
    // machine in "stopping": capture it, release the stream, and fall through to a
    // clean idle state below so the recorder can start again.
    let finalizeError: string | null = null;
    try {
      store.finalize(Date.now());
      await store.whenClosed();
    } catch (error) {
      finalizeError = error instanceof Error ? error.message : String(error);
      log.warn("session finalization failed:", finalizeError);
      store.dispose();
    }
    this.microphone = { state: "off", error: null, activeDevice: null };

    if (intent === "discard") {
      try {
        if (!this.deps.deleteSession) {
          throw new Error("Session deletion is not configured.");
        }
        await this.deps.deleteSession(store.meta.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store = null;
        this.lastCompleted = { id: store.meta.id, dir: store.dir };
        this.lastProcessed = false;
        this.lastFinish = { sessionId: store.meta.id, outcome: "saved" };
        this.transition = "none";
        this.emit();
        this.schedulePostProcess(store.dir);
        log.warn("discard cleanup failed:", message);
        return {
          ok: false,
          sessionId: store.meta.id,
          error: `Recording stopped, but its files could not be discarded: ${message}`,
        };
      }

      this.store = null;
      this.transition = "none";
      this.lastFinish = { sessionId: store.meta.id, outcome: "discarded" };
      log.info("Recording discarded:", store.meta.id);
      this.emit();
      return { ok: true, sessionId: store.meta.id };
    }

    this.store = null;
    this.lastCompleted = { id: store.meta.id, dir: store.dir };
    this.lastProcessed = false;
    this.lastFinish = { sessionId: store.meta.id, outcome: "saved" };
    this.transition = "none";
    log.info("Recording stopped:", store.meta.id, `(${store.eventCount} events)`);
    this.emit();
    // Frames + correlation run in the background so the UI returns promptly.
    this.schedulePostProcess(store.dir);
    if (finalizeError) {
      return {
        ok: false,
        sessionId: store.meta.id,
        error: `Recording stopped, but finalizing its files failed: ${finalizeError}`,
      };
    }
    return { ok: true, sessionId: store.meta.id, sessionDir: store.dir };
  }

  private schedulePostProcess(dir: string): void {
    const processing = this.runPostProcess(dir, Promise.resolve());
    this.processing.add(processing);
    void processing.finally(() => this.processing.delete(processing));
  }

  private async runPostProcess(dir: string, closed: Promise<void>): Promise<void> {
    if (!this.deps.postProcess) {
      if (this.lastCompleted?.dir === dir) this.lastProcessed = true;
      this.emit();
      return;
    }
    try {
      await closed;
      await this.deps.postProcess(dir);
    } catch (error) {
      log.warn("post-processing failed:", error instanceof Error ? error.message : error);
    } finally {
      if (this.lastCompleted?.dir === dir) this.lastProcessed = true;
      this.emit();
    }
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  private onAudioCaptureEnded(event: AudioCaptureEnded): void {
    if (!this.store || this.transition !== "none") return;
    const error = event.error ?? "The microphone stopped unexpectedly.";
    this.microphone = { state: "error", error, activeDevice: null };
    this.emit();
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.operations.then(work, work);
    this.operations = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

function readStartEpoch(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("startEpoch" in value)) return null;
  const startEpoch = value.startEpoch;
  return typeof startEpoch === "number" && Number.isFinite(startEpoch) ? startEpoch : null;
}

function isMicrophoneDevice(value: unknown): value is MicrophoneDevice {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "label" in value &&
    typeof value.label === "string" &&
    "groupId" in value &&
    typeof value.groupId === "string"
  );
}
