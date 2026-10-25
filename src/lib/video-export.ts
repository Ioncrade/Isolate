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
  readFrame: (frameIndex: number) => Promise<ImageData>
  readMask: (frameIndex: number) => Promise<Uint8Array | null>
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
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

export async function createTransparentWebm({
  clip,
  readFrame,
  readMask,
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

  const [firstFrame, firstMask] = await Promise.all([readFrame(0), readMask(0)])
  const outputFrame = compositeCutoutFrame(firstFrame, firstMask)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.putImageData(outputFrame, 0, 0)

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
    const startedAt = performance.now()
    track.requestFrame?.()
    onProgress?.(1, clip.frameCount)

    for (let frameIndex = 1; frameIndex < clip.frameCount; frameIndex += 1) {
      if (signal?.aborted) throw new DOMException('Video export cancelled.', 'AbortError')
      if (recordingError) throw recordingError
      const [frame, mask] = await Promise.all([readFrame(frameIndex), readMask(frameIndex)])
      compositeCutoutFrame(frame, mask, outputFrame)
      const targetTime = startedAt + (frameIndex / clip.analysisFps) * 1000
      await wait(Math.max(0, targetTime - performance.now()))
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.putImageData(outputFrame, 0, 0)
      track.requestFrame?.()
      onProgress?.(frameIndex + 1, clip.frameCount)
    }

    await wait(Math.max(0, startedAt + clip.duration * 1000 - performance.now()))

    if (recorder.state === 'recording') recorder.stop()
    await stopped
    if (recordingError) throw recordingError
    const recording = new Blob(chunks, { type: mimeType })
    if (!recording.size) throw new Error('The browser produced an empty WebM video.')
    const blob = await fixWebmDuration(recording, clip.duration * 1000, { logger: false })
    return { blob, mimeType }
  } catch (error) {
    if (recorder.state === 'recording') recorder.stop()
    await stopped
    throw error
  } finally {
    track.stop()
    for (const streamTrack of stream.getTracks()) streamTrack.stop()
  }
}
