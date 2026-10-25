import type {
  ComputeBackend,
  ModelProgress,
  PredictionResult,
  PromptPoint,
} from '../types'

interface WorkerReply {
  type: 'ready' | 'prediction' | 'cleared' | 'error' | 'progress'
  id?: number
  backend?: ComputeBackend
  progress?: ModelProgress
  message?: string
  maskBuffer?: ArrayBuffer
  maskBlob?: Blob
  width?: number
  height?: number
  score?: number
  elapsedMs?: number
}

interface PendingRequest {
  resolve: (value: WorkerReply) => void
  reject: (error: Error) => void
}

export class SamClient {
  private readonly worker = new Worker(new URL('../workers/sam2.worker.ts', import.meta.url), {
    type: 'module',
  })
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private progressListener: ((progress: ModelProgress) => void) | null = null

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (reply.type === 'progress' && reply.progress) {
        this.progressListener?.(reply.progress)
        return
      }
      if (reply.id === undefined) return
      const pending = this.pending.get(reply.id)
      if (!pending) return
      this.pending.delete(reply.id)
      if (reply.type === 'error') {
        pending.reject(new Error(reply.message ?? 'SAM2 worker failed.'))
      } else {
        pending.resolve(reply)
      }
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'SAM2 worker stopped unexpectedly.')
      for (const request of this.pending.values()) request.reject(error)
      this.pending.clear()
    }
  }

  onProgress(listener: ((progress: ModelProgress) => void) | null) {
    this.progressListener = listener
  }

  private request(message: Record<string, unknown>, transfer: Transferable[] = []) {
    const id = this.nextId++
    const promise = new Promise<WorkerReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.worker.postMessage({ ...message, id }, transfer)
    return promise
  }

  async initialize(preferredBackend: ComputeBackend) {
    const reply = await this.request({ type: 'init', preferredBackend })
    return reply.backend ?? 'wasm'
  }

  async predict(
    frameKey: string,
    image: ImageData,
    points: PromptPoint[],
  ): Promise<PredictionResult> {
    const rgba = image.data.slice().buffer
    const reply = await this.request(
      {
        type: 'predict',
        frameKey,
        rgba,
        width: image.width,
        height: image.height,
        points,
      },
      [rgba],
    )
    if (!reply.maskBuffer || !reply.maskBlob) throw new Error('SAM2 returned an empty mask.')
    return {
      mask: new Uint8Array(reply.maskBuffer),
      maskBlob: reply.maskBlob,
      width: reply.width ?? image.width,
      height: reply.height ?? image.height,
      score: reply.score ?? 0,
      elapsedMs: reply.elapsedMs ?? 0,
    }
  }

  async clear() {
    await this.request({ type: 'clear' })
  }

  dispose() {
    this.worker.terminate()
    this.pending.clear()
  }
}

