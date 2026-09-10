/**
 * §5 — how far the share render oversamples the diagram.
 *
 * Its own module because it is the only arithmetic in the share path, and the ceilings
 * it respects are the difference between a crisp PNG and no PNG at all.
 */

/**
 * Device pixels we aim for across the image. A recipe is read on a phone at 3x and
 * pinched into: 2400 keeps even the smallest table crisp under a zoom.
 */
const TARGET_WIDTH = 2400

/** iOS Safari refuses a canvas past ~4096 on a side, or past ~16.7M pixels. */
const MAX_SIDE = 4096
const MAX_AREA = 16_000_000

/**
 * Small diagrams get the full 3x; a wide one steps down so the canvas stays inside the
 * ceilings above — an oversized render does not come back blurry, it comes back `null`,
 * which is the one thing §5 says must not happen.
 */
export function rasterScale(width: number, height: number): number {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const wanted = Math.min(3, Math.max(2, TARGET_WIDTH / w))
  const capped = Math.min(wanted, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)))
  // Rounded *down* to two places: rounding to nearest can add back the fraction of a
  // percent that puts a 3000px-wide diagram over the 4096 side limit.
  // A diagram big enough to hit the floor is past saving by scale alone; a downscaled
  // render of it still beats no render.
  return Math.max(0.5, Math.floor(capped * 100) / 100)
}
