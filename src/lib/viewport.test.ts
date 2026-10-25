import { describe, expect, it } from 'vitest'
import { clampViewPan, clampViewZoom, containViewSize, zoomAroundPoint } from './viewport'

describe('canvas viewport math', () => {
  it('contains landscape and portrait frames inside the full viewport', () => {
    expect(containViewSize(1920, 1080, 1047, 571)).toEqual({
      width: 1015.1111111111111,
      height: 571,
    })
    expect(containViewSize(1080, 1920, 1047, 571)).toEqual({
      width: 321.1875,
      height: 571,
    })
    expect(containViewSize(0, 1080, 1047, 571)).toEqual({ width: 0, height: 0 })
  })

  it('keeps zoom inside the supported range', () => {
    expect(clampViewZoom(0.4)).toBe(1)
    expect(clampViewZoom(3.2)).toBe(3.2)
    expect(clampViewZoom(12)).toBe(8)
  })

  it('holds the pointer anchor still while zooming', () => {
    expect(zoomAroundPoint({ x: 0, y: 0 }, 1, 2, { x: 100, y: -40 })).toEqual({
      x: -100,
      y: 40,
    })
  })

  it('clamps panning to the transformed canvas bounds', () => {
    expect(clampViewPan({ x: 900, y: -900 }, 2, 600, 400, 800, 500)).toEqual({
      x: 200,
      y: -150,
    })
    expect(clampViewPan({ x: 50, y: 50 }, 1, 600, 400, 800, 500)).toEqual({ x: 0, y: 0 })
  })
})
