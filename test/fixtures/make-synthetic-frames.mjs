// Regenerates the frame PNGs of the synthetic golden session (test/fixtures/session-synthetic).
// Run from the repo root: node test/fixtures/make-synthetic-frames.mjs
// Each shot is a grid of 64 px tiles whose colour depends on the shot number, so a test can tell
// which shot ended up in a package by reading the top-left pixel.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "session-synthetic");
const shots = JSON.parse(readFileSync(path.join(dir, "shots.json"), "utf8"));
const SIZES = { 1: [2560, 1600], 2: [2560, 1440] };
mkdirSync(path.join(dir, "shots"), { recursive: true });

for (const [i, shot] of shots.entries()) {
  const [w, h] = SIZES[shot.displayId];
  const data = Buffer.alloc(w * h * 3);
  const base = [(i * 37 + 20) % 200, (i * 71 + 40) % 200, (i * 113 + 60) % 200];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = ((x >> 6) + (y >> 6)) % 2;
      // Fine 3 px stripes, so pixelating a region visibly changes it.
      const stripe = Math.floor(x / 3) % 2 === 0 ? 0 : 25;
      const o = (y * w + x) * 3;
      data[o] = base[0] + tile * 40 + stripe;
      data[o + 1] = base[1] + tile * 30 + stripe;
      data[o + 2] = base[2] + tile * 20 + stripe;
    }
  }
  const png = await sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(path.join(dir, shot.file), png);
}
console.log(`wrote ${shots.length} frames`);
