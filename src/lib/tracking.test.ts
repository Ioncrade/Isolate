import { describe, expect, it } from 'vitest'
import { pointsFromMask } from './tracking'

describe('prompt propagation', () => {
  it('derives positive prompts inside the previous matte', () => {
    const width = 20
    const height = 20
    const mask = new Uint8Array(width * height)
    for (let y = 5; y < 15; y += 1) {
      for (let x = 4; x < 16; x += 1) mask[y * width + x] = 255
    }
    const points = pointsFromMask(mask, width, height, [{ x: 1, y: 1, label: 0 }])
    expect(points.filter((point) => point.label === 1).length).toBeGreaterThanOrEqual(3)
    expect(points.at(-1)).toEqual({ x: 1, y: 1, label: 0 })
    for (const point of points.filter((item) => item.label === 1)) {
      expect(mask[point.y * width + point.x]).toBe(255)
    }
  })

  it('rejects an empty prior mask', () => {
    expect(() => pointsFromMask(new Uint8Array(100), 10, 10, [])).toThrow('no subject mask')
  })
})

