import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  MAX_WORKING_EDGE,
  MAX_WORKING_PIXELS,
  formatBytes,
  formatTime,
  getWorkingSize,
  validateClip,
} from './limits'

describe('memory and media limits', () => {
  it('caps 4K landscape sources at the 2K/QHD envelope', () => {
    const result = getWorkingSize(3840, 2160)
    expect(result.width).toBe(MAX_WORKING_EDGE)
    expect(result.height).toBe(1440)
    expect(result.width * result.height).toBe(MAX_WORKING_PIXELS)
  })

  it('preserves source resolution at or below the 2K/QHD envelope', () => {
    expect(getWorkingSize(1920, 1080)).toMatchObject({ width: 1920, height: 1080, scale: 1 })
    expect(getWorkingSize(2560, 1440)).toMatchObject({ width: 2560, height: 1440, scale: 1 })
  })

  it('caps portrait and square footage by edge and pixel area', () => {
    expect(getWorkingSize(2160, 3840)).toMatchObject({ width: 1440, height: 2560 })
    expect(getWorkingSize(2160, 2160)).toMatchObject({ width: 1920, height: 1920 })
  })

  it('does not enlarge small sources', () => {
    expect(getWorkingSize(640, 360)).toMatchObject({ width: 640, height: 360, scale: 1 })
  })

  it('formats operator-facing measurements', () => {
    expect(formatTime(3.25)).toBe('00:03:25')
    expect(formatBytes(64 * 1024 * 1024)).toBe('64 MB')
  })

  it('admits 500 MB and rejects anything larger', () => {
    const accepted = { type: 'video/mp4', size: MAX_UPLOAD_BYTES } as File
    const rejected = { type: 'video/mp4', size: MAX_UPLOAD_BYTES + 1 } as File
    expect(validateClip(accepted, 20)).toBeNull()
    expect(validateClip(rejected, 20)).toContain('500 MB')
  })
})

