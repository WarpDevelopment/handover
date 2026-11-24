import type {
  ClickTarget,
  ControlRole,
  PointerClickPayload,
  UnavailableReason,
  WindowBounds,
} from "../../common/events";

/** One validated line from the native helper. Anything else is dropped. */
export type HelperMessage =
  | { kind: "hello"; version: string }
  | { kind: "capabilities"; hook: boolean; accessibility: boolean | null }
  | { kind: "click"; click: Omit<PointerClickPayload, "space"> }
  | { kind: "error"; message: string }
  | { kind: "hook_lost" }
  | { kind: "blind"; reason: "elevated_window"; state: "start" | "end"; process?: string }
  | { kind: "selftest" };

/**
 * Splits a byte stream into lines on LF only, stripping a trailing CR. Unlike readline it does NOT
 * break on U+2028, U+2029 or U+0085, which can appear raw in a control name (NAT-3). A line longer
 * than `maxLine` is dropped whole, so a runaway helper cannot grow the buffer without bound.
 */
export function createLineSplitter(onLine: (line: string) => void, maxLine = MAX_LINE * 2): {
  push(chunk: string): void;
  end(): void;
} {
  let buffer = "";
  let discarding = false;
  const emit = (line: string) => {
    onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let i = buffer.indexOf("\n");
      while (i >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (discarding) discarding = false;
        else emit(line);
        i = buffer.indexOf("\n");
      }
      if (buffer.length > maxLine) {
        buffer = "";
        discarding = true;
      }
    },
    end() {
      if (buffer.length > 0 && !discarding) emit(buffer);
      buffer = "";
    },
  };
}

const ROLES: readonly ControlRole[] = [
  "button", "textbox", "combobox", "option", "menuitem", "link", "tab",
  "checkbox", "radio", "cell", "row", "listitem", "treeitem", "dialog",
  "window", "pane", "document", "text", "image", "other",
];
const REASONS: readonly UnavailableReason[] = [
  "helper_missing", "timeout", "permission_missing", "remote_session",
  "opaque_toolkit", "elevated_window", "secure_field",
];
const MAX_TEXT = 200;
const MAX_LINE = 64 * 1024;
// Control characters plus the Unicode line separators U+2028 and U+2029. Built from a string because
// a regex literal may not contain a raw line terminator.
const CONTROL_OR_SEPARATOR = new RegExp("[\\p{Cc}\\u{2028}\\u{2029}]", "gu");

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(CONTROL_OR_SEPARATOR, " ").slice(0, max);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bounds(value: unknown): WindowBounds | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const x = num(v.x);
  const y = num(v.y);
  const width = num(v.width);
  const height = num(v.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function role(value: unknown): ControlRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as ControlRole)
    : "other";
}

/**
 * Rebuilds a ClickTarget from untrusted helper output, field by field, so nothing the helper
 * did not declare (and the schema does not allow) can reach events.jsonl.
 */
export function sanitizeTarget(value: unknown): ClickTarget | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const grounding = v.grounding === "accessibility" || v.grounding === "accessibility_weak" ? v.grounding : null;
  const source = v.source === "ax" || v.source === "uia" ? v.source : null;
  const name = text(v.name);
  if (!grounding || !source || name === undefined) return null;

  const target: ClickTarget = {
    grounding,
    source,
    role: role(v.role),
    nativeRole: text(v.nativeRole) ?? "",
    name,
    isPassword: v.isPassword === true,
  };
  const automationId = text(v.automationId);
  if (automationId) target.automationId = automationId;
  const axIdentifier = text(v.axIdentifier);
  if (axIdentifier) target.axIdentifier = axIdentifier;
  const b = bounds(v.bounds);
  if (b) target.bounds = b;
  if (Array.isArray(v.ancestry)) {
    target.ancestry = v.ancestry.slice(0, 6).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const e = entry as Record<string, unknown>;
      return [{ role: role(e.role), name: text(e.name) ?? "" }];
    });
  }
  if (v.app && typeof v.app === "object") {
    const a = v.app as Record<string, unknown>;
    const appName = text(a.name);
    if (appName !== undefined) {
      target.app = { name: appName };
      const proc = text(a.process);
      if (proc) target.app.process = proc;
      const bundleId = text(a.bundleId);
      if (bundleId) target.app.bundleId = bundleId;
    }
  }
  const windowTitle = text(v.windowTitle);
  if (windowTitle) target.windowTitle = windowTitle;
  return target;
}

/** Parses one stdout line. Returns null for anything malformed or unknown (it is ignored, never fatal). */
export function parseHelperLine(line: string): HelperMessage | null {
  if (line.length === 0 || line.length > MAX_LINE) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;

  switch (m.type) {
    case "hello":
      return { kind: "hello", version: text(m.version, 40) ?? "unknown" };
    case "capabilities":
      return {
        kind: "capabilities",
        hook: m.hook !== false,
        accessibility: typeof m.accessibility === "boolean" ? m.accessibility : null,
      };
    case "error":
      return { kind: "error", message: text(m.message) ?? "unknown error" };
    case "hook_lost":
      return { kind: "hook_lost" };
    case "selftest":
      return { kind: "selftest" };
    case "blind": {
      if (m.reason !== "elevated_window") return null;
      if (m.state !== "start" && m.state !== "end") return null;
      const msg: HelperMessage = { kind: "blind", reason: "elevated_window", state: m.state };
      // An executable name only: drop any path the helper might send, then control characters.
      const raw = text(m.process, 120)?.split(/[\\/]/).pop()?.trim().slice(0, 60);
      if (m.state === "start" && raw) msg.process = raw;
      return msg;
    }
    case "click": {
      const x = num(m.x);
      const y = num(m.y);
      const button = m.button === "left" || m.button === "right" || m.button === "middle" ? m.button : null;
      if (x === undefined || y === undefined || !button) return null;
      const click: Omit<PointerClickPayload, "space"> = {
        button,
        clickCount: m.clickCount === 2 ? 2 : 1,
        x,
        y,
      };
      const target = sanitizeTarget(m.target);
      const reason =
        typeof m.unavailableReason === "string" && (REASONS as readonly string[]).includes(m.unavailableReason)
          ? (m.unavailableReason as UnavailableReason)
          : undefined;
      if (target) click.target = target;
      if (reason) click.unavailableReason = reason;
      // A click with no usable control must say why (tester-package.md §4.2).
      if (!click.target && !click.unavailableReason) click.unavailableReason = "opaque_toolkit";
      const lookupMs = num(m.lookupMs);
      if (lookupMs !== undefined && lookupMs >= 0) click.lookupMs = Math.round(lookupMs);
      return { kind: "click", click };
    }
    default:
      return null;
  }
}
