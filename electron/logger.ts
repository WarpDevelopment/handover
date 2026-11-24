import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { redactHome } from "./redact-paths";

/** Rotate the active log once it reaches this size (the diagnostics zip carries it all). */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
/** Keep this many daily files (plus their single rotated `.1` sibling). */
const KEEP_DAYS = 7;

type Level = "INFO" | "WARN" | "ERROR";

interface FileSink {
  dir: string;
  maxBytes: number;
  now: () => Date;
}

let sink: FileSink | null = null;

function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** `handover-YYYYMMDD.log` for the given day. */
export function logFileName(d: Date): string {
  return `handover-${ymd(d)}.log`;
}

/**
 * Turn log arguments into one line without ever writing an event payload. Strings,
 * numbers and booleans pass through; an Error becomes `Name: message` (no stack);
 * everything else (objects, arrays) is replaced by a placeholder so a payload object
 * passed by mistake never reaches disk.
 */
export function formatLogArgs(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a.replace(/[\r\n]+/g, " ");
      if (typeof a === "number" || typeof a === "boolean" || a == null) return String(a);
      if (a instanceof Error) return `${a.name}: ${a.message}`.replace(/[\r\n]+/g, " ");
      return Array.isArray(a) ? "<array>" : "<object>";
    })
    .join(" ");
}

/**
 * Start writing logs to `<dir>/handover-YYYYMMDD.log`, rotating at `maxBytes`.
 * Call once from main after the app is ready; before that (and in tests) loggers are
 * console-only. Returns a function that stops the file sink.
 */
export function initFileLogging(
  dir: string,
  opts: { maxBytes?: number; now?: () => Date } = {},
): () => void {
  mkdirSync(dir, { recursive: true });
  sink = { dir, maxBytes: opts.maxBytes ?? LOG_MAX_BYTES, now: opts.now ?? (() => new Date()) };
  pruneOldLogs(dir);
  return () => {
    sink = null;
  };
}

function pruneOldLogs(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => /^handover-\d{8}(\.1)?\.log$/.test(f))
      .sort();
    const days = [...new Set(files.map((f) => f.slice(0, "handover-YYYYMMDD".length)))];
    for (const stale of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) {
      for (const f of files.filter((x) => x.startsWith(stale))) rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    // best effort
  }
}

function writeLine(level: Level, tag: string, args: readonly unknown[]): void {
  const s = sink;
  if (!s) return;
  try {
    const now = s.now();
    const file = path.join(s.dir, logFileName(now));
    if (existsSync(file) && statSync(file).size >= s.maxBytes) {
      const rotated = file.replace(/\.log$/, ".1.log");
      rmSync(rotated, { force: true });
      renameSync(file, rotated);
    }
    // The log goes into the diagnostics zip: no absolute path may name the OS user (SEC-8).
    appendFileSync(file, `${now.toISOString()} ${level} [${tag}] ${redactHome(formatLogArgs(args))}\n`);
  } catch {
    // Logging must never break the app.
  }
}

/** Tagged logger: console always, plus the file sink once {@link initFileLogging} ran. */
export function createLogger(tag: string) {
  const prefix = `[${tag}]`;
  return {
    info: (...args: unknown[]) => {
      console.log(prefix, ...args);
      writeLine("INFO", tag, args);
    },
    warn: (...args: unknown[]) => {
      console.warn(prefix, ...args);
      writeLine("WARN", tag, args);
    },
    error: (...args: unknown[]) => {
      console.error(prefix, ...args);
      writeLine("ERROR", tag, args);
    },
  };
}
