/// <reference lib="webworker" />

import { AutoProcessor, RawImage, Sam2Model, env } from '@huggingface/transformers'
import type { ComputeBackend, ModelProgress, PromptPoint } from '../types'

const MODEL_ID = 'onnx-community/sam2.1-hiera-tiny-ONNX'

type RequestMessage =
  | { type: 'init'; id: number; preferredBackend: ComputeBackend }
  | {
      type: 'predict'
      id: number
      frameKey: string
      rgba: ArrayBuffer
      width: number
      height: number
      points: PromptPoint[]
    }
  | { type: 'clear'; id: number }

interface CachedEmbedding {
  frameKey: string
  tensors: Record<string, { dispose?: () => void }>
}

let model: Sam2Model | null = null
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let backend: ComputeBackend = 'wasm'
let cachedEmbedding: CachedEmbedding | null = null

env.allowLocalModels = false
env.useBrowserCache = true
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, self.navigator.hardwareConcurrency || 2))
}

function send(message: unknown, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

function releaseEmbedding() {
  if (!cachedEmbedding) return
  for (const tensor of Object.values(cachedEmbedding.tensors)) tensor.dispose?.()
  cachedEmbedding = null
}

async function initialize(preferredBackend: ComputeBackend) {
  if (model && processor) return backend
  const canUseWebGpu = preferredBackend === 'webgpu' && 'gpu' in self.navigator
  const attempts: Array<{ backend: ComputeBackend; dtype: 'q4f16' | 'q8' }> = canUseWebGpu
    ? [
        { backend: 'webgpu', dtype: 'q4f16' },
        { backend: 'wasm', dtype: 'q8' },
      ]
    : [{ backend: 'wasm', dtype: 'q8' }]

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      processor = await AutoProcessor.from_pretrained(MODEL_ID)
      model = (await Sam2Model.from_pretrained(MODEL_ID, {
        device: attempt.backend,
        dtype: attempt.dtype,
        progress_callback: (progress: ModelProgress) => {
          send({ type: 'progress', progress })
        },
      })) as Sam2Model
      backend = attempt.backend
      return backend
    } catch (error) {
      lastError = error
      model = null
      processor = null
    }
  }
  throw lastError instanceof Error ? lastError : new Error('SAM2 could not be loaded on this device.')
}

function selectBestMask(scores: ArrayLike<number>) {
  let best = 0
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] > scores[best]) best = index
  }
  return best
}

async function maskToBlob(mask: Uint8Array, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Offscreen canvas is unavailable.')
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4
    rgba[offset] = 255
    rgba[offset + 1] = 255
    rgba[offset + 2] = 255
    rgba[offset + 3] = mask[pixel]
  }
  context.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function predict(
  frameKey: string,
  rgbaBuffer: ArrayBuffer,
  width: number,
  height: number,
  points: PromptPoint[],
) {
  if (!model || !processor) throw new Error('Load the SAM2 model before segmenting.')
  if (!points.some((point) => point.label === 1)) {
    throw new Error('Add at least one subject point before segmenting.')
  }

  const started = performance.now()
  const rawImage = new RawImage(new Uint8ClampedArray(rgbaBuffer), width, height, 4).rgb()
  const inputPoints = [[points.map((point) => [point.x, point.y])]]
  const inputLabels = [[points.map((point) => point.label)]]
  const inputs = await processor(rawImage, {
    input_points: inputPoints,
    input_labels: inputLabels,
  })

  if (!cachedEmbedding || cachedEmbedding.frameKey !== frameKey) {
    releaseEmbedding()
    const tensors = await model.get_image_embeddings({ pixel_values: inputs.pixel_values })
    cachedEmbedding = { frameKey, tensors }
  }

  const output = await model({ ...inputs, ...cachedEmbedding.tensors })
  const processedMasks = await (
    processor as unknown as {
      post_process_masks: (
        masks: unknown,
        originalSizes: Array<[number, number]>,
        reshapedSizes: Array<[number, number]>,
      ) => Promise<Array<{ data: ArrayLike<number>; dims: number[] }>>
    }
  ).post_process_masks(output.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes)

  const scoreData = output.iou_scores.data as ArrayLike<number>
  const bestMask = selectBestMask(scoreData)
  const tensor = processedMasks[0]
  const pixelCount = width * height
  const mask = new Uint8Array(pixelCount)
  const offset = bestMask * pixelCount
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    mask[pixel] = tensor.data[offset + pixel] ? 255 : 0
  }
  const blob = await maskToBlob(mask, width, height)
  return {
    mask,
    blob,
    score: Number(scoreData[bestMask] ?? 0),
    elapsedMs: performance.now() - started,
  }
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const request = event.data
  try {
    if (request.type === 'init') {
      const activeBackend = await initialize(request.preferredBackend)
      send({ type: 'ready', id: request.id, backend: activeBackend })
      return
    }
    if (request.type === 'clear') {
      releaseEmbedding()
      send({ type: 'cleared', id: request.id })
      return
    }
    const result = await predict(
      request.frameKey,
      request.rgba,
      request.width,
      request.height,
      request.points,
    )
    const maskBuffer = result.mask.buffer as ArrayBuffer
    send(
      {
        type: 'prediction',
        id: request.id,
        maskBuffer,
        maskBlob: result.blob,
        width: request.width,
        height: request.height,
        score: result.score,
        elapsedMs: result.elapsedMs,
      },
      [maskBuffer],
    )
  } catch (error) {
    send({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Unexpected SAM2 error.',
    })
  }
}

