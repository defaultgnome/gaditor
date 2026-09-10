import { describe, expect, it } from 'vitest'
import { rasterScale } from './rasterScale'

const MAX_SIDE = 4096
const MAX_AREA = 16_000_000

describe('rasterScale', () => {
  it('oversamples a small diagram to the 3x ceiling', () => {
    expect(rasterScale(600, 400)).toBe(3)
  })

  it('steps down as the diagram widens, so the output stays around the target', () => {
    expect(rasterScale(1200, 500)).toBe(2)
    expect(rasterScale(2000, 600)).toBe(2)
  })

  it('never drops below 2x while the canvas ceilings allow it', () => {
    expect(rasterScale(1800, 700)).toBeGreaterThanOrEqual(2)
  })

  it('keeps every side inside the canvas limit', () => {
    for (const [w, h] of [
      [600, 400],
      [1400, 900],
      [3000, 1200],
      [900, 3800],
      [6000, 400],
    ]) {
      const scale = rasterScale(w, h)
      expect(w * scale).toBeLessThanOrEqual(MAX_SIDE)
      expect(h * scale).toBeLessThanOrEqual(MAX_SIDE)
      expect(w * scale * h * scale).toBeLessThanOrEqual(MAX_AREA + 1)
    }
  })

  it('survives a degenerate measurement rather than returning 0 or Infinity', () => {
    expect(rasterScale(0, 0)).toBe(3)
    expect(rasterScale(-10, 0)).toBe(3)
  })

  it('bottoms out instead of vanishing on an enormous diagram', () => {
    expect(rasterScale(40000, 30000)).toBe(0.5)
  })
})
