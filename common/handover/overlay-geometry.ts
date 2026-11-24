// Coordinate maths for the freeze overlay. The overlay draws in CSS pixels (device-independent
// pixels, DIP); annotations are saved in the display's physical pixels (dpx). The conversion uses
// the display's `scaleFactor` and nothing else, so it is the same on Windows (125%, 150%…) and
// macOS (2x). Pure: no Electron.

export interface OverlayDisplay {
  /** Display physical size, the size of the frozen frame's display (`DisplaysPayload` `sizeDpx`). */
  sizeDpx: [number, number];
  scaleFactor: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A point drawn in CSS px → display physical px, rounded to whole pixels and kept on the display. */
export function cssToDpx(point: [number, number], d: OverlayDisplay): [number, number] {
  return [
    clamp(Math.round(point[0] * d.scaleFactor), 0, d.sizeDpx[0]),
    clamp(Math.round(point[1] * d.scaleFactor), 0, d.sizeDpx[1]),
  ];
}

/** Inverse of {@link cssToDpx}, for drawing saved shapes back on the overlay. */
export function dpxToCss(point: [number, number], d: OverlayDisplay): [number, number] {
  return [point[0] / d.scaleFactor, point[1] / d.scaleFactor];
}

/** The size of the overlay's drawing surface in CSS px: the display's physical size over its scale factor. */
export function overlayCssSize(d: OverlayDisplay): [number, number] {
  return [Math.round(d.sizeDpx[0] / d.scaleFactor), Math.round(d.sizeDpx[1] / d.scaleFactor)];
}

/**
 * The window rectangle for a display's freeze overlay: its bounds in DIP, rounded to whole units.
 * Electron places and sizes windows in DIP on both platforms, so the overlay covers exactly one
 * display and never a union of displays.
 */
export function overlayBounds(display: {
  bounds: { x: number; y: number; width: number; height: number };
}): { x: number; y: number; width: number; height: number } {
  const b = display.bounds;
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}

/** True when a point lies inside a window's bounds (left and top edges in, right and bottom edges out). */
export function pointInBounds(
  p: { x: number; y: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

/** Keep at most `max` points of a freehand stroke, always the first and the last. */
export function thinPoints<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
