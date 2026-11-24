// Coordinate and image-size maths for the tester package (tester-package.md §4.3).
// Pure functions: no Electron, no image library.

import type { DisplaysPayload, GlobalSpace, WindowBounds } from "../events";

export type DisplayInfo = DisplaysPayload["displays"][number];
export type Rect = [number, number, number, number];

/** Long edge of a full image, and the token budget (tester-package.md §4.3). */
export const MAX_LONG_EDGE = 1568;
export const MAX_TOKENS = 1568;
export const TOKEN_CELL = 28;
/** Frames are captured at native resolution up to this width. */
export const MAX_CAPTURE_WIDTH = 2560;
/** Crop window: 800×500 logical px. */
export const CROP_LOGICAL: [number, number] = [800, 500];

export function estTokens(width: number, height: number): number {
  return Math.ceil(width / TOKEN_CELL) * Math.ceil(height / TOKEN_CELL);
}

/**
 * Largest size with the same aspect ratio as `width`×`height` whose long edge is at most
 * 1,568 px and whose `ceil(w/28)×ceil(h/28)` is at most 1,568. Never upscales.
 */
export function fitFullImage(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new Error("fitFullImage needs a positive size");
  const long = Math.max(width, height);
  for (let edge = Math.min(MAX_LONG_EDGE, long); edge >= 1; edge--) {
    const k = edge / long;
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    if (estTokens(w, h) <= MAX_TOKENS) return { width: w, height: h };
  }
  return { width: 1, height: 1 };
}

/** Units of the global space per display physical pixel: 1/scaleFactor on macOS, 1 on Windows. */
function unitsPerDpx(space: GlobalSpace, d: DisplayInfo): number {
  return space === "macos_global_points" ? 1 / d.scaleFactor : 1;
}

/** dpx per global unit. */
function dpxPerUnit(space: GlobalSpace, d: DisplayInfo): number {
  return space === "macos_global_points" ? d.scaleFactor : 1;
}

/** Extent of a display in global units. */
export function extentGlobal(space: GlobalSpace, d: DisplayInfo): [number, number] {
  const u = unitsPerDpx(space, d);
  return [d.sizeDpx[0] * u, d.sizeDpx[1] * u];
}

/**
 * The display containing a global point; when none does, the nearest one.
 * Returns undefined only when the layout is empty.
 */
export function displayForGlobalPoint(
  layout: DisplaysPayload,
  x: number,
  y: number,
): DisplayInfo | undefined {
  let best: DisplayInfo | undefined;
  let bestDist = Infinity;
  for (const d of layout.displays) {
    const [w, h] = extentGlobal(layout.globalSpace, d);
    const [ox, oy] = d.originGlobal;
    const dx = x < ox ? ox - x : x >= ox + w ? x - (ox + w) : 0;
    const dy = y < oy ? oy - y : y >= oy + h ? y - (oy + h) : 0;
    const dist = dx * dx + dy * dy;
    if (dist === 0) return d;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** macOS: dpx = (p − originGlobal) × scaleFactor. Windows: dpx = p − originGlobal. */
export function globalToDpx(
  space: GlobalSpace,
  d: DisplayInfo,
  x: number,
  y: number,
): [number, number] {
  const k = dpxPerUnit(space, d);
  return [(x - d.originGlobal[0]) * k, (y - d.originGlobal[1]) * k];
}

/** Inverse of {@link globalToDpx}. */
export function dpxToGlobal(
  space: GlobalSpace,
  d: DisplayInfo,
  x: number,
  y: number,
): [number, number] {
  const k = 1 / dpxPerUnit(space, d);
  return [x * k + d.originGlobal[0], y * k + d.originGlobal[1]];
}

export function boundsToDpx(space: GlobalSpace, d: DisplayInfo, b: WindowBounds): Rect {
  const k = dpxPerUnit(space, d);
  const [x, y] = globalToDpx(space, d, b.x, b.y);
  return [x, y, b.width * k, b.height * k];
}

/** Size of the frame the capture produces for a display: native, capped at 2,560 px wide. */
export function captureSize(d: DisplayInfo): { width: number; height: number } {
  const [w, h] = d.sizeDpx;
  if (w <= MAX_CAPTURE_WIDTH) return { width: w, height: h };
  const k = MAX_CAPTURE_WIDTH / w;
  return { width: MAX_CAPTURE_WIDTH, height: Math.max(1, Math.round(h * k)) };
}

/** `scale` of a frame of this display: full-image px per dpx (tester-package.md §4.3). */
export function expectedFrameScale(d: DisplayInfo): number {
  const cap = captureSize(d);
  const full = fitFullImage(cap.width, cap.height);
  return full.width / d.sizeDpx[0];
}

/** fpx = (dpx − source_rect_dpx[0:2]) × scale. */
export function dpxToFpx(source: Rect, scale: number, x: number, y: number): [number, number] {
  return [(x - source[0]) * scale, (y - source[1]) * scale];
}

export function fpxToDpx(source: Rect, scale: number, x: number, y: number): [number, number] {
  return [x / scale + source[0], y / scale + source[1]];
}

export interface CropPlan {
  /** Crop rectangle in display dpx. */
  rectDpx: Rect;
  /** Crop rectangle in pixels of the captured (native) frame, for cutting the pixels. */
  rectFrame: Rect;
  /** Output size, at most 800×500. */
  out: { width: number; height: number };
  /** Crop origin in full-image px. */
  originFpx: [number, number];
  /** Output px per full-image px. */
  cropScale: number;
}

/**
 * Plan the 800×500 logical-px crop (×scale_factor in dpx), centred on `centreDpx`, shifted to
 * stay inside the display, cut from the native frame and output at most 800×500.
 */
export function planCrop(args: {
  display: DisplayInfo;
  frameWidth: number;
  frameHeight: number;
  fullScale: number;
  centreDpx: [number, number];
}): CropPlan {
  const { display, frameWidth, frameHeight, fullScale, centreDpx } = args;
  const [dw, dh] = display.sizeDpx;
  const cw = Math.min(dw, Math.round(CROP_LOGICAL[0] * display.scaleFactor));
  const ch = Math.min(dh, Math.round(CROP_LOGICAL[1] * display.scaleFactor));
  const cx = Math.round(Math.min(Math.max(centreDpx[0] - cw / 2, 0), dw - cw));
  const cy = Math.round(Math.min(Math.max(centreDpx[1] - ch / 2, 0), dh - ch));
  const kx = frameWidth / dw;
  const ky = frameHeight / dh;
  const fx = Math.round(cx * kx);
  const fy = Math.round(cy * ky);
  const fw = Math.max(1, Math.min(frameWidth - fx, Math.round(cw * kx)));
  const fh = Math.max(1, Math.min(frameHeight - fy, Math.round(ch * ky)));
  const shrink = Math.min(1, CROP_LOGICAL[0] / fw, CROP_LOGICAL[1] / fh);
  const out = {
    width: Math.max(1, Math.round(fw * shrink)),
    height: Math.max(1, Math.round(fh * shrink)),
  };
  const originFpx: [number, number] = [cx * fullScale, cy * fullScale];
  const cropScale = out.width / (cw * fullScale);
  return { rectDpx: [cx, cy, cw, ch], rectFrame: [fx, fy, fw, fh], out, originFpx, cropScale };
}

/**
 * The crop of a click step. It is centred on the target's bounds, except when those bounds are
 * larger than the crop (a pane or document: its centre can be far from the click) or when the
 * resulting crop would not contain the click point. Then it is centred on the click point, so the
 * thing the user clicked is always in the picture (tester-package.md §4.3).
 */
export function planClickCrop(args: {
  display: DisplayInfo;
  frameWidth: number;
  frameHeight: number;
  fullScale: number;
  pointDpx: [number, number];
  elementDpx?: Rect;
}): CropPlan {
  const { pointDpx, elementDpx, ...rest } = args;
  const onPoint = () => planCrop({ ...rest, centreDpx: pointDpx });
  if (!elementDpx) return onPoint();
  const plan = planCrop({
    ...rest,
    centreDpx: [elementDpx[0] + elementDpx[2] / 2, elementDpx[1] + elementDpx[3] / 2],
  });
  const [cx, cy, cw, ch] = plan.rectDpx;
  const tooBig = elementDpx[2] > cw || elementDpx[3] > ch;
  const holdsClick =
    pointDpx[0] >= cx && pointDpx[0] < cx + cw && pointDpx[1] >= cy && pointDpx[1] < cy + ch;
  return tooBig || !holdsClick ? onPoint() : plan;
}

/** Point in the full image → point in its crop. */
export function fpxToCrop(
  origin: [number, number],
  cropScale: number,
  x: number,
  y: number,
): [number, number] {
  return [(x - origin[0]) * cropScale, (y - origin[1]) * cropScale];
}

/** Point in a crop → point in the full image. */
export function cropToFpx(
  origin: [number, number],
  cropScale: number,
  x: number,
  y: number,
): [number, number] {
  return [x / cropScale + origin[0], y / cropScale + origin[1]];
}

/**
 * The newest frame at least `minLeadMs` before `tMs`. Frames are `{t}` objects in any order.
 * Returns undefined when there is none.
 */
export function selectBeforeFrame<T extends { t: number }>(
  frames: readonly T[],
  tMs: number,
  minLeadMs = 50,
): T | undefined {
  let best: T | undefined;
  for (const f of frames) {
    if (f.t > tMs - minLeadMs) continue;
    if (!best || f.t > best.t) best = f;
  }
  return best;
}
