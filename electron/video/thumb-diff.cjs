// Cheap "did the screen change" test for the capture preload. The frame is drawn to a 64x40
// thumbnail and compared pixel by pixel with the previous one. A 9x8 perceptual hash was too
// coarse: on a 2,560 px frame each cell is ~280 px wide, so a dropdown or a small dialog could
// pass as "unchanged" and the step would get a before frame without it.
const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 40;
/** A pixel counts as changed when any colour channel moves by more than this (0-255). */
const CHANNEL_DELTA = 16;
/** At most this many changed thumbnail pixels still count as "unchanged" (a mouse cursor). */
const MAX_CHANGED_PIXELS = 1;

/** Number of thumbnail pixels whose colour changed. Both arrays are RGBA of equal length. */
function changedPixels(prev, next) {
  let changed = 0;
  for (let i = 0; i + 2 < next.length; i += 4) {
    if (
      Math.abs(prev[i] - next[i]) > CHANNEL_DELTA ||
      Math.abs(prev[i + 1] - next[i + 1]) > CHANNEL_DELTA ||
      Math.abs(prev[i + 2] - next[i + 2]) > CHANNEL_DELTA
    ) {
      changed++;
    }
  }
  return changed;
}

/** True when `next` shows the same screen as `prev` (so the previous JPEG can be reused). */
function isUnchanged(prev, next) {
  if (!prev || prev.length !== next.length) return false;
  return changedPixels(prev, next) <= MAX_CHANGED_PIXELS;
}

module.exports = { THUMB_WIDTH, THUMB_HEIGHT, CHANNEL_DELTA, MAX_CHANGED_PIXELS, changedPixels, isUnchanged };
