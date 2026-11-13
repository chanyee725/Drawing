// Badge chip (spec docs/research/eraser/09-examples-style.md §2.1, issue #115): a small solid pill that sits on
// an element's top-right corner. Shared by the diagram painter (`badge:` on a node) and the progress-board
// overlay (the state glyph on a step's corner, web/src/run/RunLayer.tsx), so both draw the same chip.

/** Chip height; the pill radius is half of it, so a chip with one glyph is a circle of radius 9. */
export const BADGE_H = 18;
/** Room left and right of the text. */
export const BADGE_PAD_X = 6;
/** Text size and weight inside the chip (white on a solid fill reads better a little heavier). */
export const BADGE_FONT_SIZE = 11;
export const BADGE_FONT_WEIGHT = 600;

/**
 * The chip box for a corner at (`cx`, `cy`) and text `textW` wide. The chip's right-hand cap is centred on the
 * corner, so a one-glyph chip is a circle on the corner and a longer chip runs left along the top edge.
 */
export function badgeRect(cx: number, cy: number, textW: number): { x: number; y: number; w: number; h: number } {
  const w = Math.max(BADGE_H, Math.ceil(textW + BADGE_PAD_X * 2));
  return { x: cx + BADGE_H / 2 - w, y: cy - BADGE_H / 2, w, h: BADGE_H };
}
