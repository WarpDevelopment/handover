import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { GlobalSpace } from "../../common/events";
import type { Collector, CollectorContext } from "../recorder/collector";
import { parseHelperLine } from "./helper-protocol";
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
  now?: () => number;
}

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
  private readonly now: () => number;

  private ctx: CollectorContext | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = true;
  private restarts = 0;
  private startedAt = 0;
  private openGap: "helper_restart" | "permission_lost" | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;

  constructor(options: PointerHelperOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.resolve = options.resolve ?? (() => defaultHelperLaunch(this.platform));
    this.tracker = options.tracker ?? helperTracker;
    this.maxRestarts = options.maxRestarts ?? 3;
    this.restartDelayMs = options.restartDelayMs ?? 500;
    this.helloTimeoutMs = options.helloTimeoutMs ?? 5000;
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
      this.onExit(`spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.child = child;

    this.helloTimer = setTimeout(() => {
      ctx.log.error("Click helper did not say hello in time; stopping it.");
      child.kill();
    }, this.helloTimeoutMs);

    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    createInterface({ input: child.stderr }).on("line", (line) => ctx.log.info("helper:", line));
    // An EPIPE on stdin after the helper dies must not become an uncaught exception.
    child.stdin.on("error", () => undefined);
    child.on("error", (err) => this.onExit(`spawn error: ${err.message}`, child));
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
        this.endGap("helper_restart");
        break;
      case "capabilities":
        if (!message.hook && message.accessibility === false) {
          // macOS: the tap cannot be created until Accessibility is granted. No clicks at all.
          this.tracker.setState("no-permission", "Accessibility permission not granted");
          this.beginGap("permission_lost");
        } else if (message.accessibility === false) {
          // Clicks still arrive, as visual-only steps with permission_missing.
          this.tracker.setState("no-permission", "Accessibility permission not granted");
          this.endGap("permission_lost");
        } else {
          this.tracker.setState("ok");
          this.endGap("permission_lost");
        }
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
      case "selftest":
        break;
    }
  }

  private trackerStateAfterError(): "ok" | "no-permission" {
    return this.tracker.report().helper === "no-permission" ? "no-permission" : "ok";
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
    this.beginGap("helper_restart");

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

  private beginGap(reason: "helper_restart" | "permission_lost"): void {
    if (!this.ctx || this.openGap === reason) return;
    this.openGap = reason;
    this.ctx.publish("gap", { reason });
  }

  private endGap(reason: "helper_restart" | "permission_lost"): void {
    if (!this.ctx || this.openGap !== reason) return;
    this.openGap = null;
    this.ctx.publish("gap", { reason, tEndMs: Math.max(0, this.now() - this.startedAt) });
  }
}
