import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { GlobalSpace } from "../../common/events";
import type { Collector, CollectorContext } from "../recorder/collector";
import { createLineSplitter, parseHelperLine } from "./helper-protocol";
import { defaultHelperLaunch, helperTracker, type HelperLaunch, type HelperTracker } from "./helper-status";

export interface PointerHelperOptions {
  platform?: NodeJS.Platform;
  /** Where to find the helper; null means it is not installed. */
  resolve?: () => HelperLaunch | null;
  tracker?: HelperTracker;
  /** Restarts allowed after a crash before the helper is left stopped for this session. */
  maxRestarts?: number;
  restartDelayMs?: number;
  /** How long to wait for `hello` before treating the helper as hung. */
  helloTimeoutMs?: number;
  /** A helper that ran this long before exiting gets its restart allowance back (NAT-8). */
  stableMs?: number;
  /** After a resume, how long to wait for the helper to confirm an administrator window is still in front. */
  resumeGraceMs?: number;
  now?: () => number;
}

type GapReason = "helper_restart" | "permission_lost";

/**
 * Spawns the native click helper and turns its JSON lines into `pointer.click` events.
 *
 * It never throws into the recording: a missing helper, a crash or a missing permission is logged,
 * shown in the doctor, and written to the event stream as a `gap`, and the session carries on.
 *
 * Gap convention: a `gap` WITHOUT `tEndMs` opens a gap at the event's time; a later `gap` of the same
 * reason WITH `tEndMs` closes it.
 *
 * The event `t` is stamped when the click is appended, which is `lookupMs` after the real mouse-down.
 */
export class PointerHelperCollector implements Collector {
  readonly name = "PointerHelper";

  private readonly platform: NodeJS.Platform;
  private readonly resolve: () => HelperLaunch | null;
  private readonly tracker: HelperTracker;
  private readonly maxRestarts: number;
  private readonly restartDelayMs: number;
  private readonly helloTimeoutMs: number;
  private readonly stableMs: number;
  private readonly now: () => number;

  private ctx: CollectorContext | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = true;
  private restarts = 0;
  private startedAt = 0;
  private spawnedAt = 0;
  private openGap: GapReason | null = null;
  private elevatedOpen = false;
  private elevatedNow = false;
  private elevatedProcess: string | undefined;
  private paused = false;
  private resumeTimer: NodeJS.Timeout | null = null;
  private readonly resumeGraceMs: number;
  private restartTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;

  constructor(options: PointerHelperOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.resolve = options.resolve ?? (() => defaultHelperLaunch(this.platform));
    this.tracker = options.tracker ?? helperTracker;
    this.maxRestarts = options.maxRestarts ?? 3;
    this.restartDelayMs = options.restartDelayMs ?? 500;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
    this.stableMs = options.stableMs ?? 60_000;
    // The helper checks the foreground window once a second, plus its loop and pipe time, so its "left" line can
    // reach us about 1.1 s after the window really left. 2 s leaves a real margin; 1.2 s left only ~200 ms.
    this.resumeGraceMs = options.resumeGraceMs ?? 2000;
    this.now = options.now ?? Date.now;
  }

  private get space(): GlobalSpace {
    return this.platform === "darwin" ? "macos_global_points" : "windows_virtual_px";
  }

  start(ctx: CollectorContext): void {
    this.ctx = ctx;
    this.stopping = false;
    this.restarts = 0;
    this.startedAt = this.now();
    this.openGap = null;
    this.elevatedOpen = false;
    this.elevatedNow = false;
    this.elevatedProcess = undefined;
    this.paused = false;
    this.tracker.reset();

    const launch = this.resolve();
    if (!launch) {
      ctx.log.warn("Click helper not found; recording continues without control capture.");
      this.tracker.setState("missing", "Helper binary not found");
      this.beginGap("helper_restart");
      return;
    }
    this.spawnHelper(launch);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.restartTimer = null;
    this.helloTimer = null;
    this.elevatedNow = false;
    this.endElevated(); // before ctx is dropped; an unclosed gap would otherwise run to session end
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => child.kill(), 1000);
        child.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        // The helper exits by itself when stdin closes.
        try {
          child.stdin.end();
        } catch {
          child.kill();
        }
      });
    }
    this.ctx = null;
  }

  private spawnHelper(launch: HelperLaunch): void {
    const ctx = this.ctx;
    if (!ctx) return;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.file, launch.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      this.onExit(`spawn failed (${errorCode(err)})`);
      return;
    }
    this.child = child;
    this.spawnedAt = this.now();

    this.helloTimer = setTimeout(() => {
      ctx.log.error("Click helper did not say hello in time; stopping it.");
      child.kill();
    }, this.helloTimeoutMs);

    // Split on LF only: readline also breaks on U+2028/U+2029/U+0085, which can sit inside a control name.
    const out = createLineSplitter((line) => this.onLine(line));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => out.push(chunk));
    child.stdout.on("end", () => out.end());
    const err = createLineSplitter((line) => ctx.log.info("helper:", line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => err.push(chunk));
    child.stderr.on("end", () => err.end());
    // An EPIPE on stdin after the helper dies must not become an uncaught exception.
    child.stdin.on("error", () => undefined);
    // Never store err.message: it carries the executable path, which includes the OS username (SEC-7).
    child.on("error", (e) => this.onExit(`spawn error (${errorCode(e)})`, child));
    child.on("exit", (code, signal) =>
      this.onExit(`helper exited (${signal ?? `code ${code ?? "?"}`})`, child),
    );
  }

  private onLine(line: string): void {
    const ctx = this.ctx;
    if (!ctx || this.stopping) return;
    const message = parseHelperLine(line);
    if (!message) {
      ctx.log.warn("Ignored a malformed helper line.");
      return;
    }

    switch (message.kind) {
      case "hello":
        if (this.helloTimer) clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.tracker.setVersion(message.version);
        this.tracker.setState("ok");
        // The gap stays open until `capabilities` confirms the hook is installed.
        break;
      case "capabilities":
        // Branch on the hook first (NAT-4): without it no click arrives, whatever the permission says.
        if (message.hook === false) {
          if (message.accessibility === false) {
            // macOS: the tap cannot be created (or was torn down) without Accessibility. No clicks at all.
            this.tracker.setState("no-permission", "Accessibility permission not granted");
            this.beginGap("permission_lost");
          } else {
            this.tracker.setState("crashed", "Mouse hook is not installed");
            this.beginGap("helper_restart");
          }
        } else if (message.accessibility === false) {
          // Clicks still arrive, as visual-only steps with permission_missing.
          this.tracker.setState("no-permission", "Accessibility permission not granted");
          this.endGap();
        } else {
          this.tracker.setState("ok");
          this.endGap();
        }
        break;
      case "hook_lost":
        // Windows watchdog: the hook was silently removed. The helper reinstalls it and then re-sends
        // `capabilities` with hook:true, which closes this gap.
        this.tracker.setState("crashed", "Mouse hook was removed by Windows; reinstalling");
        this.beginGap("helper_restart");
        break;
      case "error":
        this.tracker.setState(this.trackerStateAfterError(), message.message);
        ctx.log.error("helper error:", message.message);
        break;
      case "click": {
        const { click } = message;
        ctx.publish("pointer.click", { ...click, space: this.space });
        this.tracker.recordClick(click.target?.grounding ?? "none", click.lookupMs);
        break;
      }
      case "blind":
        // Not a helper fault and not a pause: other collectors keep running, only clicks are unseen.
        // State only. Never the process name or a window title: the app log goes into the diagnostics zip.
        ctx.log.info(`helper: blind ${message.state}`);
        if (message.state === "start") {
          this.elevatedNow = true;
          this.elevatedProcess = message.process;
          this.beginElevated();
        } else {
          this.elevatedNow = false;
          this.elevatedProcess = undefined;
          this.endElevated();
        }
        break;
      case "selftest":
        break;
    }
  }

  /**
   * The controller pauses or resumes the recording. A pause is off the record: no elevated_window gap and no
   * process name is written while paused, so a gap that is open when the pause begins is closed at that
   * moment, and on resume one opens again only if the helper still says an administrator window is in front.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.endElevated();
      return;
    }
    // The helper's state can be a second old, and the Resume click itself moves the foreground to Handover's
    // bar, so do not trust it at once: wait, and open only if the helper has not said the window left. The gap
    // is stamped with the resume time, not the time the timer fires.
    if (!this.ctx || !this.elevatedNow || this.elevatedOpen || this.resumeTimer) return;
    const tStartMs = Math.max(0, Math.round(this.elapsed()));
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.beginElevated(tStartMs);
      if (this.elevatedOpen) this.ctx?.log.info("resume: elevated gap opened");
    }, this.resumeGraceMs);
  }

  private elapsed(): number {
    return this.ctx?.elapsedMs ? this.ctx.elapsedMs() : this.now() - this.startedAt;
  }

  /**
   * An administrator window is in front, so Windows withholds clicks from this normal-integrity helper.
   * `elevatedNow` is what the helper last said; `elevatedOpen` is whether a gap is open for it. They differ
   * while paused. Tracked apart from `openGap` (one reason at a time there) because it can overlap a
   * helper_restart.
   */
  private beginElevated(tStartMs?: number): void {
    if (!this.ctx || this.paused || !this.elevatedNow || this.elevatedOpen || this.resumeTimer) return;
    this.elevatedOpen = true;
    this.ctx.publish("gap", {
      reason: "elevated_window",
      ...(this.elevatedProcess ? { process: this.elevatedProcess } : {}),
      ...(tStartMs !== undefined ? { tStartMs } : {}),
    });
  }

  private endElevated(): void {
    // A pause, stop, helper exit or the helper's own end cancels a resume that is still waiting.
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.ctx?.log.info("resume: cancelled");
    }
    this.resumeTimer = null;
    if (!this.ctx || !this.elevatedOpen) return;
    this.elevatedOpen = false;
    const tEndMs = this.ctx.elapsedMs ? this.ctx.elapsedMs() : this.now() - this.startedAt;
    this.ctx.publish("gap", { reason: "elevated_window", tEndMs: Math.max(0, Math.round(tEndMs)) });
  }

  /** An `error` line must not make an unhealthy helper look healthy: keep a non-ok state (NAT-4). */
  private trackerStateAfterError(): "ok" | "no-permission" | "crashed" {
    const state = this.tracker.report().helper;
    return state === "no-permission" || state === "crashed" ? state : "ok";
  }

  private onExit(reason: string, which?: ChildProcessWithoutNullStreams): void {
    if (which && this.child !== which) return; // a stale child from before a restart
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.child = null;
    if (this.stopping || !this.ctx) return;

    const ctx = this.ctx;
    ctx.log.error(`Click helper stopped: ${reason}`);
    this.tracker.setState("crashed", reason);
    this.elevatedNow = false;
    this.endElevated(); // the new helper announces it again if it is still true
    this.beginGap("helper_restart");

    // A helper that ran stably for a while earns its restart allowance back (NAT-8).
    if (this.spawnedAt > 0 && this.now() - this.spawnedAt >= this.stableMs) this.restarts = 0;
    if (this.restarts >= this.maxRestarts) {
      ctx.log.error("Click helper restart limit reached; recording continues without it.");
      return;
    }
    this.restarts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping) return;
      const launch = this.resolve();
      if (!launch) {
        this.tracker.setState("missing", "Helper binary not found");
        return;
      }
      this.spawnHelper(launch);
    }, this.restartDelayMs * this.restarts);
  }

  private beginGap(reason: GapReason): void {
    if (!this.ctx || this.openGap === reason) return;
    if (this.openGap) this.endGap(); // one gap open at a time: close the other reason first
    this.openGap = reason;
    this.ctx.publish("gap", { reason });
  }

  /** Closes whichever gap is open. Its end is on the session clock, the same as an event's `t` (NAT-7). */
  private endGap(): void {
    const reason = this.openGap;
    if (!this.ctx || !reason) return;
    this.openGap = null;
    const tEndMs = this.ctx.elapsedMs ? this.ctx.elapsedMs() : this.now() - this.startedAt;
    this.ctx.publish("gap", { reason, tEndMs: Math.max(0, Math.round(tEndMs)) });
  }
}

/** A short, path-free description of a spawn failure: the Node error code, never the message. */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unknown";
}
