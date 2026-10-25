import { getAnalysisFps, getWorkingSize } from './limits'
import type { ClipMetadata } from '../types'

function waitForEvent(target: EventTarget, event: string, timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out while waiting for video ${event}.`))
    }, timeoutMs)
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('The browser could not decode this video. Try H.264 or VP9.'))
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      target.removeEventListener(event, onEvent)
      target.removeEventListener('error', onError)
    }
    target.addEventListener(event, onEvent, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

export class VideoFrameReader {
  private readonly video = document.createElement('video')
  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private objectUrl: string | null = null
  private metadata: ClipMetadata | null = null

  constructor() {
    this.video.muted = true
    this.video.playsInline = true
    this.video.preload = 'auto'
    const context = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas is unavailable in this browser.')
    this.context = context
  }

  async open(file: File, existing?: Pick<ClipMetadata, 'id' | 'createdAt'>): Promise<ClipMetadata> {
    this.close()
    this.objectUrl = URL.createObjectURL(file)
    this.video.src = this.objectUrl
    this.video.load()
    await waitForEvent(this.video, 'loadedmetadata')

    const duration = this.video.duration
    const sourceWidth = this.video.videoWidth
    const sourceHeight = this.video.videoHeight
    const working = getWorkingSize(sourceWidth, sourceHeight)
    const analysisFps = getAnalysisFps(duration)
    const frameCount = Math.max(1, Math.ceil(duration * analysisFps))
    this.canvas.width = working.width
    this.canvas.height = working.height
    this.metadata = {
      id: existing?.id ?? crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ''),
      duration,
      width: sourceWidth,
      height: sourceHeight,
      workingWidth: working.width,
      workingHeight: working.height,
      analysisFps,
      frameCount,
      fileSize: file.size,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    return this.metadata
  }

  get currentMetadata() {
    return this.metadata
  }

  timeForFrame(frameIndex: number) {
    if (!this.metadata) throw new Error('No clip is open.')
    return Math.min(
      Math.max(0, frameIndex / this.metadata.analysisFps),
      Math.max(0, this.metadata.duration - 0.001),
    )
  }

  async readFrame(frameIndex: number): Promise<ImageData> {
    if (!this.metadata) throw new Error('No clip is open.')
    const time = this.timeForFrame(frameIndex)
    if (this.video.readyState < 2) {
      await waitForEvent(this.video, 'loadeddata')
    }
    if (Math.abs(this.video.currentTime - time) > 0.001) {
      const ready = waitForEvent(this.video, 'seeked')
      this.video.currentTime = time
      await ready
    }
    this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height)
    return this.context.getImageData(0, 0, this.canvas.width, this.canvas.height)
  }

  close() {
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
    this.metadata = null
  }
}

