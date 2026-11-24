// Deterministic serialisation helpers shared by the package builder and validator.

import { createHash } from "node:crypto";

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** JSON with sorted keys, 2-space indent and one trailing LF. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

/** One JSON object per line with sorted keys, LF endings; empty input gives an empty file. */
export function canonicalJsonl(records: readonly unknown[]): string {
  return records.map((r) => JSON.stringify(sortKeys(r)) + "\n").join("");
}

/** ISO 8601 with the offset of `timezone` at that instant, e.g. `2026-11-20T09:05:11+02:00`. */
export function isoWithOffset(epochMs: number, timezone: string): string {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(Math.floor(epochMs / 1000) * 1000))) {
    parts[p.type] = p.value;
  }
  const raw = parts.timeZoneName ?? "GMT";
  const offset = raw === "GMT" ? "+00:00" : raw.replace("GMT", "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** `YYYY-MM-DD` in the timezone. */
export function dateInTimezone(epochMs: number, timezone: string): string {
  return isoWithOffset(epochMs, timezone).slice(0, 10);
}

/** Under 60 s: one decimal and ` s`; otherwise `<m> min <s> s` with whole seconds. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/** Process title in lower kebab case, at most 40 characters. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "process";
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48-bit time then 80 random bits, Crockford base32. `random` returns 10 bytes. */
export function ulid(timeMs: number, random: Uint8Array): string {
  if (random.length < 10) throw new Error("ulid needs 10 random bytes");
  let t = Math.floor(timeMs);
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let bits = 0n;
  for (let i = 0; i < 10; i++) bits = (bits << 8n) | BigInt(random[i]);
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand = CROCKFORD[Number(bits & 31n)] + rand;
    bits >>= 5n;
  }
  return time + rand;
}
