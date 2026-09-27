/**
 * Both processes judge whether an icon is worth showing, and they have to agree:
 * main drops a blank icon so the lookup falls through to the next source, and
 * the renderer swaps one for the globe. A threshold that drifted between them
 * would leave main serving an icon the renderer then refuses to draw.
 */

/** Alpha at or above this counts as a painted pixel. */
export const OPAQUE_ALPHA = 16;

/** Below this share of painted pixels, artwork is a transparent placeholder. */
export const BLANK_OPAQUE_FRACTION = 0.02;

export function opaqueFraction(rgba: Uint8Array | Uint8ClampedArray): number {
  const pixels = rgba.length / 4;
  if (!pixels) return 1;
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= OPAQUE_ALPHA) opaque++;
  return opaque / pixels;
}
