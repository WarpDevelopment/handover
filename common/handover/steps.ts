// Deterministic step builder: a click is a step, an app switch is a step, and summaries come from
// templates. Nothing here reads typed values: summaries use control names and app names only.

import type {
  AppActivatePayload,
  ClickTarget,
  ControlRole,
  DisplaysPayload,
  PointerClickPayload,
  UnavailableReason,
  WindowBounds,
} from "../events";
import type { RecEvent } from "../types";

export type AppKind = "native" | "browser" | "remote_session" | "unknown";

export interface AppRef {
  name: string;
  process?: string;
  bundle_id?: string;
  kind: AppKind;
}

export interface StepDraft {
  kind: "action" | "context";
  observedVia: "pointer" | "window_change";
  actionType: "click" | "double_click" | "right_click" | "app_switch";
  /** ms from recording start of the click or app switch. */
  tMs: number;
  /**
   * The moment the user acted, for choosing the before frame. The helper reports a click only after
   * its control lookup (up to 300 ms), so the event time is later than the click by `lookupMs`.
   */
  frameTMs: number;
  app: AppRef;
  windowTitle?: string;
  /** Origin + path only. */
  url?: string;
  /** Present for clicks. */
  click?: PointerClickPayload;
  /** Window bounds in the global space, for placing a context step on a display. */
  windowBounds?: WindowBounds;
  /** Summary from a template, filled by {@link buildSteps}. */
  summary: string;
  /** Source event seq. */
  seq: number;
}

const BROWSERS = ["google chrome", "chrome", "microsoft edge", "msedge", "edge", "firefox", "safari",
  "brave", "brave browser", "arc", "opera", "vivaldi", "chromium"];
const REMOTE = ["mstsc", "msrdc", "windows app", "microsoft remote desktop", "citrix workspace",
  "wfica", "citrix viewer", "remote desktop connection"];

export function appKind(name: string | undefined, processName?: string): AppKind {
  const n = (name ?? "").trim().toLowerCase();
  const p = (processName ?? "").trim().toLowerCase().replace(/\.exe$/, "");
  if (!n && !p) return "unknown";
  if (REMOTE.some((r) => n === r || p === r || n.startsWith(`${r} `))) return "remote_session";
  if (BROWSERS.includes(n) || BROWSERS.includes(p)) return "browser";
  return "native";
}

/** Reduce a URL to origin plus path: scheme, host and path stay; query and fragment go. */
export function reduceUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

function clean(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const ROLE_WORD: Record<ControlRole, string> = {
  button: "button", textbox: "text box", combobox: "dropdown", option: "option",
  menuitem: "menu item", link: "link", tab: "tab", checkbox: "checkbox", radio: "radio button",
  cell: "cell", row: "row", listitem: "list item", treeitem: "tree item", dialog: "dialog",
  window: "window", pane: "pane", document: "document", text: "text", image: "image",
  other: "control",
};

const VERB: Record<StepDraft["actionType"], string> = {
  click: "Click",
  double_click: "Double-click",
  right_click: "Right-click",
  app_switch: "Switch to",
};

/** `Click button "Save" in Excel`, `Switch to Google Chrome`, `Click at (x, y) in Excel`. */
export function summaryFor(args: {
  actionType: StepDraft["actionType"];
  appName?: string;
  target?: Pick<ClickTarget, "role" | "name">;
  pointDpx?: [number, number];
}): string {
  const app = args.appName ? clean(args.appName, 60) : "";
  if (args.actionType === "app_switch") return app ? `Switch to ${app}` : "Switch application";
  const verb = VERB[args.actionType];
  const inApp = app ? ` in ${app}` : "";
  if (args.target) {
    const name = clean(args.target.name);
    const role = ROLE_WORD[args.target.role] ?? "control";
    return name ? `${verb} ${role} "${name}"${inApp}` : `${verb} ${role}${inApp}`;
  }
  const p = args.pointDpx ?? [0, 0];
  return `${verb} at (${Math.round(p[0])}, ${Math.round(p[1])})${inApp}`;
}

/** Grounding of a click, with the reason when it is not `accessibility`. */
export function groundingOf(click: PointerClickPayload): {
  grounding: "accessibility" | "accessibility_weak" | "visual_only";
  unavailable?: UnavailableReason;
} {
  if (click.target) {
    if (click.target.grounding === "accessibility") return { grounding: "accessibility" };
    return {
      grounding: "accessibility_weak",
      unavailable: click.unavailableReason ?? "opaque_toolkit",
    };
  }
  return { grounding: "visual_only", unavailable: click.unavailableReason ?? "helper_missing" };
}

/** Helper control-lookup time of a click, clamped to a sane 0 to 1,000 ms. */
export function clickLookupMs(click: Pick<PointerClickPayload, "lookupMs">): number {
  const ms = click.lookupMs;
  return typeof ms === "number" && Number.isFinite(ms) ? Math.min(1000, Math.max(0, ms)) : 0;
}

/** An app switch right after a click in the same app is the click's own effect, not a step. */
const SWITCH_AFTER_CLICK_MS = 1000;

/**
 * Walk the event stream and produce step drafts in time order. `pointer.click` becomes an action
 * step; `app.activate` for a different app becomes a context step. Everything else only updates the
 * known app, title and URL.
 *
 * `toDpx` is injected so the drafts carry no display maths: it turns a click into display pixels
 * for the summary of a `visual_only` click.
 */
export function buildSteps(
  events: readonly RecEvent[],
  toDpx: (click: PointerClickPayload, tMs: number) => [number, number],
): StepDraft[] {
  const ordered = [...events].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const steps: StepDraft[] = [];
  let app: AppRef = { name: "", kind: "unknown" };
  let title: string | undefined;
  let url: string | undefined;
  let bounds: WindowBounds | undefined;
  let lastClick: { tMs: number; appName: string } | undefined;
  let seenActivate = false;

  for (const ev of ordered) {
    switch (ev.type) {
      case "app.activate": {
        const p = ev.payload as unknown as AppActivatePayload;
        const name = typeof p.app === "string" ? p.app : "";
        const sameApp = name === app.name;
        const closeToClick =
          lastClick !== undefined &&
          lastClick.appName === name &&
          ev.t - lastClick.tMs <= SWITCH_AFTER_CLICK_MS;
        app = {
          name,
          ...(p.path ? { process: p.path.split(/[\\/]/).pop() } : {}),
          ...(p.bundleId ? { bundle_id: p.bundleId } : {}),
          kind: appKind(name, p.path?.split(/[\\/]/).pop()),
        };
        title = typeof p.title === "string" ? p.title : undefined;
        url = typeof p.url === "string" ? reduceUrl(p.url) : undefined;
        bounds = p.bounds;
        if ((!sameApp || !seenActivate) && !closeToClick && name) {
          steps.push({
            kind: "context",
            observedVia: "window_change",
            actionType: "app_switch",
            tMs: ev.t,
            frameTMs: ev.t,
            app,
            windowTitle: title,
            url,
            windowBounds: bounds,
            summary: summaryFor({ actionType: "app_switch", appName: name }),
            seq: ev.seq,
          });
        }
        seenActivate = true;
        break;
      }
      case "app.title-change": {
        const p = ev.payload as { title?: unknown };
        if (typeof p.title === "string") title = p.title;
        break;
      }
      case "browser.url": {
        const p = ev.payload as { url?: unknown };
        if (typeof p.url === "string") url = reduceUrl(p.url);
        break;
      }
      case "pointer.click": {
        const click = ev.payload as unknown as PointerClickPayload;
        const t = click.target;
        if (t?.app?.name) {
          app = {
            name: t.app.name,
            ...(t.app.process ? { process: t.app.process } : {}),
            ...(t.app.bundleId ? { bundle_id: t.app.bundleId } : {}),
            kind: appKind(t.app.name, t.app.process),
          };
        }
        if (t?.windowTitle) title = t.windowTitle;
        const actionType: StepDraft["actionType"] =
          click.button === "right" ? "right_click" : click.clickCount === 2 ? "double_click" : "click";
        const dpx = toDpx(click, ev.t);
        steps.push({
          kind: "action",
          observedVia: "pointer",
          actionType,
          tMs: ev.t,
          frameTMs: ev.t - clickLookupMs(click),
          app,
          windowTitle: title,
          url: app.kind === "browser" ? url : undefined,
          click,
          summary: summaryFor({
            actionType,
            appName: app.name,
            target: t ? { role: t.role, name: t.name } : undefined,
            pointDpx: dpx,
          }),
          seq: ev.seq,
        });
        lastClick = { tMs: ev.t, appName: app.name };
        break;
      }
      default:
        break;
    }
  }
  return steps;
}

/** The latest `displays` layout at or before `tMs`; the first one when none precedes it. */
export function layoutAt(
  layouts: readonly { t: number; payload: DisplaysPayload }[],
  tMs: number,
): DisplaysPayload | undefined {
  let best: DisplaysPayload | undefined;
  for (const l of layouts) {
    if (l.t <= tMs) best = l.payload;
  }
  return best ?? layouts[0]?.payload;
}
