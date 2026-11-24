// Display layout payload and "which displays does this event need a frame from". Pure: Electron's
// `screen` is injected, so this runs in unit tests.

import type { DisplaysPayload, GlobalSpace, PointerClickPayload } from "../events";
import type { RecEvent } from "../types";
import { displayForGlobalPoint } from "./geometry";

/** The parts of Electron's `Display` the layout needs. */
export interface ElectronDisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

export function globalSpaceFor(platform: NodeJS.Platform): GlobalSpace {
  return platform === "win32" ? "windows_virtual_px" : "macos_global_points";
}

/**
 * Layout payload for the `displays` event.
 * macOS: origin in global points, size in physical px (points x scale factor).
 * Windows: origin in virtual-screen physical px, so `dipToScreenPoint` converts the DIP origin;
 * size is physical px.
 */
export function displaysPayload(args: {
  platform: NodeJS.Platform;
  displays: readonly ElectronDisplayLike[];
  primaryId: number;
  dipToScreenPoint?: (p: { x: number; y: number }) => { x: number; y: number };
}): DisplaysPayload {
  const globalSpace = globalSpaceFor(args.platform);
  return {
    globalSpace,
    displays: args.displays.map((d) => {
      const origin =
        globalSpace === "windows_virtual_px" && args.dipToScreenPoint
          ? args.dipToScreenPoint({ x: d.bounds.x, y: d.bounds.y })
          : { x: d.bounds.x, y: d.bounds.y };
      return {
        id: d.id,
        originGlobal: [Math.round(origin.x), Math.round(origin.y)] as [number, number],
        sizeDpx: [
          Math.round(d.size.width * d.scaleFactor),
          Math.round(d.size.height * d.scaleFactor),
        ] as [number, number],
        scaleFactor: d.scaleFactor,
        primary: d.id === args.primaryId,
      };
    }),
  };
}

/** True when two layouts differ in anything that changes coordinate conversion. */
export function layoutChanged(a: DisplaysPayload | null, b: DisplaysPayload): boolean {
  return a === null || JSON.stringify(a) !== JSON.stringify(b);
}

/** Events that become steps, and so need a before frame. */
export const STEP_EVENT_TYPES: ReadonlySet<string> = new Set(["pointer.click", "app.activate"]);

/**
 * Electron display ids whose frames a step event needs: the display under a click; every display
 * for an app switch or when the layout is unknown (the builder picks the right one later).
 */
export function displaysForEvent(ev: RecEvent, layout: DisplaysPayload | null): number[] {
  if (!layout) return [];
  if (ev.type === "pointer.click") {
    const p = ev.payload as unknown as PointerClickPayload;
    const d = displayForGlobalPoint(layout, p.x, p.y);
    if (d) return [d.id];
  }
  return layout.displays.map((d) => d.id);
}
