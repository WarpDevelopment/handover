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
  observedVia: "pointer" | "window_change" | "explain";
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
const REMOTE = ["mstsc", "msrdc", "msrdcw", "windowsapp", "windows app", "microsoft remote desktop",
  "citrix workspace", "wfica", "wfica32", "citrix viewer", "remote desktop connection"];
const BROWSER_BUNDLES = ["com.google.chrome", "com.apple.safari", "org.mozilla.firefox",
  "com.microsoft.edgemac", "com.brave.browser", "company.thebrowser.browser",
  "com.operasoftware.opera", "com.vivaldi.vivaldi", "org.chromium.chromium"];
const REMOTE_BUNDLES = ["com.microsoft.rdc.macos", "com.microsoft.rdc.osx.beta", "com.citrix.receiver.nomas"];

export function appKind(
  name: string | undefined,
  processName?: string,
  bundleId?: string,
  unavailableReason?: string,
): AppKind {
  const n = (name ?? "").trim().toLowerCase();
  const p = (processName ?? "").trim().toLowerCase().replace(/\.exe$/, "");
  const b = (bundleId ?? "").trim().toLowerCase();
  if (unavailableReason === "remote_session") return "remote_session";
  if (!n && !p && !b) return "unknown";
  if (REMOTE_BUNDLES.includes(b) || REMOTE.some((r) => n === r || p === r || n.startsWith(`${r} `))) {
    return "remote_session";
  }
  if (BROWSER_BUNDLES.includes(b) || BROWSERS.includes(n) || BROWSERS.includes(p)) return "browser";
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

/** The second click of a double-click follows the first by less than this. */
const DOUBLE_CLICK_MERGE_MS = 1000;

/** Helper control-lookup time of a click, clamped to a sane 0 to 1,000 ms. */
export function clickLookupMs(click: Pick<PointerClickPayload, "lookupMs">): number {
  const ms = click.lookupMs;
  return typeof ms === "number" && Number.isFinite(ms) ? Math.min(1000, Math.max(0, ms)) : 0;
}

/**
 * The active-window poll runs every 1,000 ms, or 1,600 ms while a browser is frontmost, so an
 * `app.activate` is reported up to this long after the click that caused it (plus a little slack).
 * A click that lands this far before the report, or just after it, is the click that switched apps.
 */
const ACTIVATE_LAG_MS = 1600 + 200;
const ACTIVATE_LEAD_MS = 300;

/** The same test as {@link isOwnAppClick}, for an app name and a process or path name. */
export function isOwnAppName(name?: string, processOrPath?: string): boolean {
  const n = (name ?? "").trim().toLowerCase();
  const base = (processOrPath ?? "").split(/[\\/]/).pop() ?? "";
  const p = base.trim().toLowerCase().replace(/\.exe$/, "").replace(/\.app$/, "");
  return n === "handover" || p === "handover";
}

/** When the user acted: a click is reported after its control lookup, so back-date it by `lookupMs`. */
function actedMs(ev: RecEvent): number {
  return ev.type === "pointer.click"
    ? ev.t - clickLookupMs(ev.payload as unknown as PointerClickPayload)
    : ev.t;
}

function insideBounds(b: WindowBounds | undefined, x: number, y: number): boolean {
  return !!b && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
}

/** The app, window and URL the walk believed in after an event. */
export interface StepState {
  t: number;
  app: AppRef;
  windowTitle?: string;
  url?: string;
  windowBounds?: WindowBounds;
}

/**
 * Walk the event stream and produce step drafts in time order. `pointer.click` becomes an action
 * step; `app.activate` for a different app becomes a context step. Everything else only updates the
 * known app, title and URL.
 *
 * Clicks are ordered and timed by when the user acted (`t − lookupMs`), not when the helper
 * reported them. `toDpx` is injected so the drafts carry no display maths: it turns a click into
 * display pixels for the summary of a `visual_only` click.
 */
export function buildSteps(
  events: readonly RecEvent[],
  toDpx: (click: PointerClickPayload, tMs: number) => [number, number],
): StepDraft[] {
  return buildStepsWithState(events, toDpx).steps;
}

/** {@link buildSteps}, plus what the walk knew about the frontmost app at any moment. */
export function buildStepsWithState(
  events: readonly RecEvent[],
  toDpx: (click: PointerClickPayload, tMs: number) => [number, number],
): { steps: StepDraft[]; stateAt: (tMs: number) => StepState | undefined } {
  const ordered = [...events].sort((a, b) => actedMs(a) - actedMs(b) || a.seq - b.seq);
  const steps: StepDraft[] = [];
  const states: StepState[] = [];
  let app: AppRef = { name: "", kind: "unknown" };
  let title: string | undefined;
  let url: string | undefined;
  let bounds: WindowBounds | undefined;
  let seenActivate = false;

  const clicks = ordered
    .filter((e) => e.type === "pointer.click")
    .map((e) => {
      const c = e.payload as unknown as PointerClickPayload;
      return { acted: actedMs(e), app: c.target?.app?.name?.trim().toLowerCase(), x: c.x, y: c.y };
    });
  /** A click on this app (or, with no control found, inside its window) just before or after the report. */
  const switchedByClick = (tReport: number, name: string, activateBounds?: WindowBounds): boolean =>
    clicks.some(
      (c) =>
        c.acted >= tReport - ACTIVATE_LAG_MS &&
        c.acted <= tReport + ACTIVATE_LEAD_MS &&
        (c.app ? c.app === name.trim().toLowerCase() : insideBounds(activateBounds, c.x, c.y)),
    );
  const remember = (t: number) =>
    states.push({
      t,
      app,
      ...(title !== undefined ? { windowTitle: title } : {}),
      ...(url ? { url } : {}),
      ...(bounds ? { windowBounds: bounds } : {}),
    });

  for (const ev of ordered) {
    switch (ev.type) {
      case "app.activate": {
        const p = ev.payload as unknown as AppActivatePayload;
        const name = typeof p.app === "string" ? p.app : "";
        const sameApp = name === app.name;
        const closeToClick = switchedByClick(ev.t, name, p.bounds);
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
        remember(actedMs(ev));
        break;
      }
      case "app.title-change": {
        const p = ev.payload as { title?: unknown };
        if (typeof p.title === "string") title = p.title;
        remember(ev.t);
        break;
      }
      case "browser.url": {
        const p = ev.payload as { url?: unknown };
        if (typeof p.url === "string") url = reduceUrl(p.url);
        remember(ev.t);
        break;
      }
      case "pointer.click": {
        const click = ev.payload as unknown as PointerClickPayload;
        const t = click.target;
        const acted = actedMs(ev);
        // The app the click landed in. A click with no control found says nothing about its app:
        // it keeps the last known one only when it lies inside that app's last known window.
        let clickApp: AppRef;
        let known = true;
        if (t?.app?.name) {
          clickApp = {
            name: t.app.name,
            ...(t.app.process ? { process: t.app.process } : {}),
            ...(t.app.bundleId ? { bundle_id: t.app.bundleId } : {}),
            kind: appKind(t.app.name, t.app.process, t.app.bundleId, click.unavailableReason),
          };
          if (clickApp.name !== app.name) bounds = undefined; // the old window's bounds no longer apply
          app = clickApp;
        } else if (insideBounds(bounds, click.x, click.y)) {
          clickApp =
            click.unavailableReason === "remote_session" ? { ...app, kind: "remote_session" } : app;
          if (click.unavailableReason === "remote_session") app = clickApp;
        } else {
          clickApp = { name: "", kind: click.unavailableReason === "remote_session" ? "remote_session" : "unknown" };
          known = false;
        }
        if (t?.windowTitle) title = t.windowTitle;
        const clickTitle = known ? title : undefined;
        const actionType: StepDraft["actionType"] =
          click.button === "right" ? "right_click" : click.clickCount === 2 ? "double_click" : "click";
        const dpx = toDpx(click, acted);
        remember(acted);
        // A double-click arrives as two clicks, the second with clickCount 2: one step. A context
        // step the activate rule suppressed was never added, so it cannot sit between them.
        const prev = steps[steps.length - 1];
        if (
          click.clickCount === 2 &&
          prev?.kind === "action" &&
          prev.click?.clickCount === 1 &&
          prev.click.button === click.button &&
          acted - prev.tMs <= DOUBLE_CLICK_MERGE_MS
        ) {
          const merged: PointerClickPayload = { ...click, target: click.target ?? prev.click.target };
          prev.actionType = click.button === "right" ? "right_click" : "double_click";
          prev.click = merged;
          prev.app = clickApp;
          prev.windowTitle = clickTitle;
          prev.summary = summaryFor({
            actionType: prev.actionType,
            appName: clickApp.name,
            target: merged.target ? { role: merged.target.role, name: merged.target.name } : undefined,
            pointDpx: toDpx(merged, prev.tMs),
          });
          break;
        }
        steps.push({
          kind: "action",
          observedVia: "pointer",
          actionType,
          tMs: acted,
          frameTMs: acted,
          app: clickApp,
          windowTitle: clickTitle,
          url: clickApp.kind === "browser" ? url : undefined,
          click,
          summary: summaryFor({
            actionType,
            appName: clickApp.name,
            target: t ? { role: t.role, name: t.name } : undefined,
            pointDpx: dpx,
          }),
          seq: ev.seq,
        });
        break;
      }
      default:
        break;
    }
  }
  const stateAt = (tMs: number): StepState | undefined => {
    let best: StepState | undefined;
    for (const s of states) if (s.t <= tMs) best = s;
    return best;
  };
  return { steps, stateAt };
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
