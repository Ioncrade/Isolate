export type ComputeBackend = 'webgpu' | 'wasm'

export type PromptLabel = 0 | 1

export interface PromptPoint {
  x: number
  y: number
  label: PromptLabel
}

export interface ClipMetadata {
  id: string
  name: string
  duration: number
  width: number
  height: number
  workingWidth: number
  workingHeight: number
  analysisFps: number
  frameCount: number
  fileSize: number
  createdAt: number
}

export type FrameState = 'empty' | 'seed' | 'tracked' | 'corrected'

export interface ProjectSnapshot {
  clip: ClipMetadata
  frameStates: FrameState[]
  cacheBytes: number
  updatedAt: number
}

export interface ModelProgress {
  status: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

export interface PredictionResult {
  mask: Uint8Array
  maskBlob: Blob
  width: number
  height: number
  score: number
  elapsedMs: number
}

export type StudioPhase =
  | 'empty'
  | 'ready'
  | 'loading-model'
  | 'segmenting'
  | 'tracking'
  | 'exporting'
  | 'error'

