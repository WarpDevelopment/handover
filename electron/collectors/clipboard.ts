import { createHash } from "node:crypto";

import { clipboard } from "electron";

import type { Collector, CollectorContext } from "../recorder/collector";

const POLL_MS = 700;

function sha1(input: string | Buffer): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

/**
 * Detects clipboard changes by polling (Electron exposes no change event) and
 * emits `clipboard.change` with only the available formats, the content length and
 * a short opaque hash that acts as the change counter. It never emits any text or
 * image content (no preview): the privacy floors say no clipboard content leaves
 * the machine. The clipboard contents present at session start are used only as a
 * baseline and are never emitted.
 *
 * Cross-platform: Electron's clipboard API is uniform on macOS and Windows.
 */
export class ClipboardCollector implements Collector {
  readonly name = "clipboard";
  private timer: NodeJS.Timeout | null = null;
  private ctx: CollectorContext | null = null;
  private lastSig = "";

  start(ctx: CollectorContext): void {
    this.ctx = ctx;
    this.lastSig = this.signature().sig; // baseline; do not emit pre-session content
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.ctx = null;
  }

  /** Reads the clipboard once and derives a change signature + descriptor. */
  private signature(): { sig: string; formats: string[]; length: number; hash: string } {
    const formats = clipboard.availableFormats();
    const text = clipboard.readText();

    let length = text.length;
    let hashInput: string | Buffer = text;

    if (!text && formats.some((f) => f.startsWith("image/"))) {
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        const png = img.toPNG();
        length = png.byteLength;
        hashInput = png;
      }
    }

    const hash = sha1(hashInput);
    return { sig: `${formats.join(",")}|${length}|${hash}`, formats, length, hash };
  }

  /** Exposed for tests: one poll tick. */
  poll(): void {
    if (!this.ctx) return;
    try {
      const s = this.signature();
      if (s.sig === this.lastSig) return;
      this.lastSig = s.sig;
      if (s.formats.length === 0) return; // cleared clipboard — nothing to describe
      this.ctx.publish("clipboard.change", {
        formats: s.formats,
        length: s.length,
        hash: s.hash,
      });
    } catch (err) {
      this.ctx.log.warn("clipboard read failed:", err instanceof Error ? err.message : err);
    }
  }
}
