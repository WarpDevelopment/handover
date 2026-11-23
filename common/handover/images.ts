// Image operations for the package: full-size resize, crop and the pixelating blur. Uses `sharp`
// (no Electron). Output is PNG with all metadata stripped.

import sharp, { type Sharp } from "sharp";

import type { Rect } from "./geometry";

export interface Decoded {
  /** Raw RGB pixels (no alpha), row-major. */
  data: Buffer;
  width: number;
  height: number;
}

const BLOCK = 16;

export async function decode(bytes: Uint8Array): Promise<Decoded> {
  const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function fromRaw(img: Decoded): Sharp {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });
}

async function toPng(s: Sharp): Promise<Buffer> {
  return s.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

export function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, Math.floor(rect[0]));
  const y0 = Math.max(0, Math.floor(rect[1]));
  const x1 = Math.min(width, Math.ceil(rect[0] + rect[2]));
  const y1 = Math.min(height, Math.ceil(rect[1] + rect[3]));
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * Pixelate a rectangle in place of the pixels: the region is reduced to 16 px blocks, so its
 * content cannot be read back. Only pixels inside the rectangle change.
 */
export async function blurRect(img: Decoded, rect: Rect): Promise<Decoded> {
  const r = clampRect(rect, img.width, img.height);
  if (!r) return img;
  const [x, y, w, h] = r;
  // Two separate pipelines: sharp keeps only the last `resize` in a chain.
  const small = await toPng(
    fromRaw(img)
      .extract({ left: x, top: y, width: w, height: h })
      .resize(Math.max(1, Math.round(w / BLOCK)), Math.max(1, Math.round(h / BLOCK)), {
        kernel: "nearest",
      }),
  );
  const region = await toPng(sharp(small).resize(w, h, { kernel: "nearest" }));
  const out = await fromRaw(img)
    .composite([{ input: region, left: x, top: y }])
    .removeAlpha()
    .raw()
    .toBuffer();
  return { data: out, width: img.width, height: img.height };
}

export async function renderFull(
  img: Decoded,
  size: { width: number; height: number },
): Promise<Uint8Array> {
  const s = fromRaw(img);
  const same = size.width === img.width && size.height === img.height;
  return toPng(same ? s : s.resize(size.width, size.height, { kernel: "lanczos3" }));
}

export async function renderCrop(
  img: Decoded,
  rect: Rect,
  out: { width: number; height: number },
): Promise<Uint8Array> {
  const s = fromRaw(img).extract({
    left: rect[0],
    top: rect[1],
    width: rect[2],
    height: rect[3],
  });
  const same = out.width === rect[2] && out.height === rect[3];
  return toPng(same ? s : s.resize(out.width, out.height, { kernel: "lanczos3" }));
}

/** Width and height of a PNG without decoding the pixels. */
export async function pngSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const m = await sharp(Buffer.from(bytes)).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}
