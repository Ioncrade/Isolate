import { describe, expect, it } from 'vitest'
import { compositeCutoutFrame, getMaskFrameIndex, getVideoExportBitrate } from './video-export'
import type { ClipMetadata } from '../types'

describe('compositeCutoutFrame', () => {
  it('keeps source colors and replaces alpha with the mask', () => {
    const frame = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
    } as ImageData
    const target = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray(8),
    } as ImageData

    const result = compositeCutoutFrame(frame, new Uint8Array([255, 0]), target)

    expect(Array.from(result.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 0])
  })

  it('makes frames without masks fully transparent', () => {
    const frame = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([90, 80, 70, 255]),
    } as ImageData
    const target = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    } as ImageData

    expect(Array.from(compositeCutoutFrame(frame, null, target).data)).toEqual([90, 80, 70, 0])
  })
})

describe('getVideoExportBitrate', () => {
  it('scales export quality with resolution while preserving hard bounds', () => {
    expect(getVideoExportBitrate(960, 540)).toBe(4_000_000)
    expect(getVideoExportBitrate(1920, 1080)).toBe(8_000_000)
    expect(getVideoExportBitrate(2560, 1440)).toBeGreaterThan(10_000_000)
    expect(getVideoExportBitrate(7680, 4320)).toBe(12_000_000)
  })
})

describe('getMaskFrameIndex', () => {
  const clip = {
    duration: 20,
    analysisFps: 8,
    frameCount: 160,
  } as ClipMetadata

  it('maps source-timed frames to the nearest bounded analysis mask', () => {
    expect(getMaskFrameIndex(0, clip)).toBe(0)
    expect(getMaskFrameIndex(1 / 30, clip)).toBe(0)
    expect(getMaskFrameIndex(0.1, clip)).toBe(1)
    expect(getMaskFrameIndex(30, clip)).toBe(159)
  })
})
