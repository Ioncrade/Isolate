import type { ClipMetadata } from '../types'
import fixWebmDuration from 'fix-webm-duration'

export const VIDEO_EXPORT_LIMIT_BYTES = 64 * 1024 * 1024

export function getVideoExportBitrate(width: number, height: number) {
  const baselinePixels = 960 * 540
  const scaled = 4_000_000 * Math.sqrt((width * height) / baselinePixels)
  return Math.round(Math.max(4_000_000, Math.min(12_000_000, scaled)))
}

interface TransparentWebmOptions {
  clip: ClipMetadata
  readMask: (frameIndex: number) => Promise<Uint8Array | null>
  playSourceFrames: (
    onFrame: (source: CanvasImageSource, mediaTime: number) => void | Promise<void>,
    signal?: AbortSignal,
  ) => Promise<number>
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export function compositeCutoutFrame(
  frame: ImageData,
  mask: Uint8Array | null,
  target = new ImageData(frame.width, frame.height),
) {
  if (target.width !== frame.width || target.height !== frame.height) {
    throw new Error('Export frame dimensions changed unexpectedly.')
  }
  target.data.set(frame.data)
  for (let pixel = 0; pixel < frame.width * frame.height; pixel += 1) {
    target.data[pixel * 4 + 3] = mask?.[pixel] ?? 0
  }
  return target
}

function selectWebmMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  ) ?? null
}

export function getMaskFrameIndex(mediaTime: number, clip: ClipMetadata) {
  return Math.max(0, Math.min(clip.frameCount - 1, Math.round(mediaTime * clip.analysisFps)))
}

function writeMaskFrame(target: ImageData, mask: Uint8Array | null) {
  for (let pixel = 0; pixel < target.width * target.height; pixel += 1) {
    const offset = pixel * 4
    target.data[offset] = 255
    target.data[offset + 1] = 255
    target.data[offset + 2] = 255
    target.data[offset + 3] = mask?.[pixel] ?? 0
  }
}

type MaskResult = { mask: Uint8Array | null; error?: never } | { mask?: never; error: unknown }

function settleMask(mask: Promise<Uint8Array | null>): Promise<MaskResult> {
  return mask.then(
    (value) => ({ mask: value }),
    (error: unknown) => ({ error }),
  )
}

export async function createTransparentWebm({
  clip,
  readMask,
  playSourceFrames,
  onProgress,
  signal,
}: TransparentWebmOptions) {
  if (/Apple/i.test(navigator.vendor)) {
    throw new Error('Transparent WebM export requires Chrome, Edge, or Firefox. Safari discards WebM alpha.')
  }
  const mimeType = selectWebmMimeType()
  if (!mimeType) {
    throw new Error('This browser cannot encode transparent VP9 or VP8 WebM video.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = clip.workingWidth
  canvas.height = clip.workingHeight
  const context = canvas.getContext('2d', { alpha: true })
  if (!context || typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas video export is unavailable in this browser.')
  }

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = clip.workingWidth
  maskCanvas.height = clip.workingHeight
  const maskContext = maskCanvas.getContext('2d')
  if (!maskContext) throw new Error('Canvas mask composition is unavailable in this browser.')
  const maskFrame = maskContext.createImageData(maskCanvas.width, maskCanvas.height)
  let activeMaskIndex = 0
  writeMaskFrame(maskFrame, await readMask(activeMaskIndex))
  maskContext.putImageData(maskFrame, 0, 0)
  let prefetchedMask = clip.frameCount > 1
    ? { index: 1, result: settleMask(readMask(1)) }
    : null

  const activateMask = async (maskIndex: number) => {
    const result = prefetchedMask?.index === maskIndex
      ? await prefetchedMask.result
      : await settleMask(readMask(maskIndex))
    if ('error' in result) throw result.error
    writeMaskFrame(maskFrame, result.mask)
    maskContext.putImageData(maskFrame, 0, 0)
    activeMaskIndex = maskIndex
    const nextIndex = maskIndex + 1
    prefetchedMask = nextIndex < clip.frameCount
      ? { index: nextIndex, result: settleMask(readMask(nextIndex)) }
      : null
  }

  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  const chunks: Blob[] = []
  let outputBytes = 0
  let recordingError: Error | null = null
  let resolveStopped: (() => void) | null = null
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: getVideoExportBitrate(clip.workingWidth, clip.workingHeight),
  })

  recorder.ondataavailable = (event) => {
    if (!event.data.size) return
    outputBytes += event.data.size
    if (outputBytes > VIDEO_EXPORT_LIMIT_BYTES) {
      recordingError = new Error('Transparent video reached the 64 MB export ceiling.')
      if (recorder.state === 'recording') recorder.stop()
      return
    }
    chunks.push(event.data)
  }
  recorder.onerror = () => {
    recordingError = new Error('The browser stopped the transparent video encoder.')
    resolveStopped?.()
  }
  recorder.onstop = () => resolveStopped?.()

  try {
    recorder.start(1000)
    const encodedFrameCount = await playSourceFrames(async (source, mediaTime) => {
      if (signal?.aborted) throw new DOMException('Video export cancelled.', 'AbortError')
      if (recordingError) throw recordingError
      const maskIndex = getMaskFrameIndex(mediaTime, clip)
      if (maskIndex !== activeMaskIndex) {
        await activateMask(maskIndex)
      }
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      context.globalCompositeOperation = 'destination-in'
      context.drawImage(maskCanvas, 0, 0)
      context.globalCompositeOperation = 'source-over'
      track.requestFrame?.()
      onProgress?.(Math.min(mediaTime, clip.duration), clip.duration)
    }, signal)

    if (recorder.state === 'recording') recorder.stop()
    await stopped
    if (recordingError) throw recordingError
    const recording = new Blob(chunks, { type: mimeType })
    if (!recording.size) throw new Error('The browser produced an empty WebM video.')
    const blob = await fixWebmDuration(recording, clip.duration * 1000, { logger: false })
    return {
      blob,
      mimeType,
      frameCount: encodedFrameCount,
      frameRate: encodedFrameCount / clip.duration,
    }
  } catch (error) {
    if (recorder.state === 'recording') recorder.stop()
    await stopped
    throw error
  } finally {
    track.stop()
    for (const streamTrack of stream.getTracks()) streamTrack.stop()
  }
}
