// Renders highlights into `*_full_annotated.png` (tester-package.md §4.4). The look is fixed and the
// output is deterministic: same highlights, same bytes. No fonts are used (the H-marks are drawn from
// a built-in 5x7 pixel font), so the result does not depend on the fonts installed on the machine.

import sharp from "sharp";

export const RED = "#E5484D";
export const YELLOW = "#FFD60A";
export const STROKE_PX = 3;
export const HIGHLIGHTER_PX = 14;
export const HIGHLIGHTER_OPACITY = 0.4;
export const ARROW_HEAD_PX = 12;
export const LABEL_HEIGHT_PX = 20;

export interface RenderableHighlight {
  /** `H1`, `H2`… */
  mark: string;
  shape: "rect" | "arrow" | "highlighter" | "freehand";
  /** Points in full-image pixels (rect and arrow have exactly two). */
  geometry_fpx: [number, number][];
}

const n2 = (n: number): string => String(Math.round(n * 100) / 100);

// 5x7 glyphs, one string per row, `#` is a lit pixel. Only `H` and the digits are needed.
const GLYPHS: Record<string, string[]> = {
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
};
const GLYPH_SCALE = 2;
const GLYPH_W = 5 * GLYPH_SCALE;
const GLYPH_H = 7 * GLYPH_SCALE;
const GLYPH_GAP = GLYPH_SCALE;
const LABEL_PAD_X = 4;

function labelWidth(text: string): number {
  return LABEL_PAD_X * 2 + text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP;
}

/** The H-mark label: a red box with the mark in white pixels, outside the shape's top-left corner. */
function labelSvg(mark: string, minX: number, minY: number, imgW: number): string {
  const w = labelWidth(mark);
  const left = Math.max(0, Math.min(Math.round(minX), imgW - w));
  const top = Math.max(0, Math.round(minY) - LABEL_HEIGHT_PX);
  const parts = [`<rect x="${left}" y="${top}" width="${w}" height="${LABEL_HEIGHT_PX}" fill="${RED}"/>`];
  const textTop = top + Math.floor((LABEL_HEIGHT_PX - GLYPH_H) / 2);
  let x = left + LABEL_PAD_X;
  for (const ch of mark) {
    const g = GLYPHS[ch];
    if (g) {
      g.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] === "#") {
            parts.push(
              `<rect x="${x + rx * GLYPH_SCALE}" y="${textTop + ry * GLYPH_SCALE}" width="${GLYPH_SCALE}" height="${GLYPH_SCALE}" fill="#FFFFFF"/>`,
            );
          }
        }
      });
    }
    x += GLYPH_W + GLYPH_GAP;
  }
  return parts.join("");
}

function shapeSvg(h: RenderableHighlight): string {
  const pts = h.geometry_fpx;
  if (pts.length < 2) return "";
  const poly = pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join(" ");
  switch (h.shape) {
    case "rect": {
      const [a, b] = pts;
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.abs(b[0] - a[0]))}" height="${n2(Math.abs(b[1] - a[1]))}" fill="none" stroke="${RED}" stroke-width="${STROKE_PX}"/>`;
    }
    case "arrow": {
      const [a, b] = pts;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const head = Math.min(ARROW_HEAD_PX, len);
      const bx = b[0] - ux * head;
      const by = b[1] - uy * head;
      const half = head / 2;
      const left: [number, number] = [bx - uy * half, by + ux * half];
      const right: [number, number] = [bx + uy * half, by - ux * half];
      return (
        `<line x1="${n2(a[0])}" y1="${n2(a[1])}" x2="${n2(bx)}" y2="${n2(by)}" stroke="${RED}" stroke-width="${STROKE_PX}"/>` +
        `<polygon points="${n2(b[0])},${n2(b[1])} ${n2(left[0])},${n2(left[1])} ${n2(right[0])},${n2(right[1])}" fill="${RED}"/>`
      );
    }
    case "highlighter":
      return `<polyline points="${poly}" fill="none" stroke="${YELLOW}" stroke-opacity="${HIGHLIGHTER_OPACITY}" stroke-width="${HIGHLIGHTER_PX}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "freehand":
      return `<polyline points="${poly}" fill="none" stroke="${RED}" stroke-width="${STROKE_PX}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

/** The SVG overlay for a full image of `width`×`height` px. Exported for tests. */
export function annotationSvg(
  width: number,
  height: number,
  highlights: readonly RenderableHighlight[],
): string {
  const shapes = highlights.map(shapeSvg).join("");
  const labels = highlights
    .filter((h) => h.geometry_fpx.length >= 2)
    .map((h) => {
      const xs = h.geometry_fpx.map((p) => p[0]);
      const ys = h.geometry_fpx.map((p) => p[1]);
      // The label sits outside the stroke of the shape's top-left corner.
      return labelSvg(h.mark, Math.min(...xs), Math.min(...ys) - STROKE_PX / 2, width);
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes}${labels}</svg>`;
}

/** Draw `highlights` on a PNG and return the new PNG. Highlights are drawn in the order given. */
export async function renderAnnotated(
  fullPng: Uint8Array,
  highlights: readonly RenderableHighlight[],
): Promise<Uint8Array> {
  const base = sharp(Buffer.from(fullPng));
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("annotated image: cannot read the full image size");
  const svg = annotationSvg(width, height, highlights);
  return sharp(Buffer.from(fullPng))
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}
