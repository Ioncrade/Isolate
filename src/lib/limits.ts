export const MAX_CLIP_SECONDS = 20
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024
export const MAX_WORKING_EDGE = 2560
export const MAX_WORKING_PIXELS = 2560 * 1440
export const MAX_ANALYSIS_FRAMES = 200
export const MASK_CACHE_LIMIT_BYTES = 64 * 1024 * 1024

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number
}

export function getAnalysisFps(duration: number): number {
  const deviceMemory = (navigator as NavigatorWithMemory).deviceMemory ?? 4
  const hardwareThreads = navigator.hardwareConcurrency || 4
  const deviceRate = deviceMemory <= 4 || hardwareThreads <= 4 ? 6 : 8
  return Math.max(1, Math.min(deviceRate, Math.floor(MAX_ANALYSIS_FRAMES / duration)))
}

export function getWorkingSize(width: number, height: number) {
  const edgeScale = MAX_WORKING_EDGE / Math.max(width, height)
  const pixelScale = Math.sqrt(MAX_WORKING_PIXELS / (width * height))
  const scale = Math.min(1, edgeScale, pixelScale)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const mins = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const frames = Math.floor((safe % 1) * 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

export function validateClip(file: File, duration: number): string | null {
  if (!file.type.startsWith('video/')) return 'Choose a video file to begin.'
  if (!Number.isFinite(duration) || duration <= 0) return 'The browser could not read this clip.'
  if (duration > MAX_CLIP_SECONDS + 0.01) {
    return `This clip is ${duration.toFixed(1)} seconds. Isolate accepts a maximum of ${MAX_CLIP_SECONDS} seconds.`
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `This file is ${formatBytes(file.size)}. The local safety limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`
  }
  return null
}

