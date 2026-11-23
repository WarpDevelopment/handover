export const THUMB_WIDTH: number;
export const THUMB_HEIGHT: number;
export const CHANNEL_DELTA: number;
export const MAX_CHANGED_PIXELS: number;
export function changedPixels(prev: ArrayLike<number>, next: ArrayLike<number>): number;
export function isUnchanged(prev: ArrayLike<number> | null | undefined, next: ArrayLike<number>): boolean;
