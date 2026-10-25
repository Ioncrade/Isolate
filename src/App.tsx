import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleMinus,
  CirclePlus,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  Film,
  Layers3,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import isolateLogo from '../isolate-logo.webp'
import { CanvasViewer } from './components/CanvasViewer'
import { maskBlobToPixels } from './lib/image'
import {
  MASK_CACHE_LIMIT_BYTES,
  MAX_CLIP_SECONDS,
  formatBytes,
  formatTime,
  validateClip,
} from './lib/limits'
import { SamClient } from './lib/sam-client'
import { ProjectStorage } from './lib/storage'
import { pointsFromMask } from './lib/tracking'
import { VideoFrameReader } from './lib/video'
import { createTransparentWebm } from './lib/video-export'
import type {
  ClipMetadata,
  ComputeBackend,
  FrameState,
  ModelProgress,
  PredictionResult,
  ProjectSnapshot,
  PromptLabel,
  PromptPoint,
  StudioPhase,
} from './types'

type TrackDirection = 'forward' | 'backward' | 'both'

const EMPTY_MESSAGE = 'Open a clip to begin. Nothing leaves this device.'

function clipBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '')
}

function progressPercent(progress: ModelProgress | null) {
  if (!progress) return 0
  if (typeof progress.progress === 'number') return Math.max(0, Math.min(100, progress.progress))
  if (progress.loaded && progress.total) return Math.round((progress.loaded / progress.total) * 100)
  return 0
}

function modelFileLabel(progress: ModelProgress | null) {
  if (!progress?.file) return 'Preparing SAM2'
  const file = progress.file.split('/').at(-1) ?? progress.file
  return file.replace(/\.onnx(_data)?$/, '').replaceAll('_', ' ')
}

function frameStateLabel(state: FrameState) {
  if (state === 'seed') return 'Prompted frame'
  if (state === 'tracked') return 'Tracked mask'
  if (state === 'corrected') return 'Corrected frame'
  return 'Not processed'
}

export function App() {
  const readerRef = useRef<VideoFrameReader | null>(null)
  const samRef = useRef<SamClient | null>(null)
  const storageRef = useRef<ProjectStorage | null>(null)
  if (!readerRef.current) readerRef.current = new VideoFrameReader()
  if (!samRef.current) samRef.current = new SamClient()
  if (!storageRef.current) storageRef.current = new ProjectStorage()

  const inputRef = useRef<HTMLInputElement>(null)
  const annotationsRef = useRef(new Map<number, PromptPoint[]>())
  const cancelTrackingRef = useRef(false)
  const exportAbortRef = useRef<AbortController | null>(null)
  const [clip, setClip] = useState<ClipMetadata | null>(null)
  const [recovery, setRecovery] = useState<ProjectSnapshot | null>(null)
  const [frameStates, setFrameStates] = useState<FrameState[]>([])
  const [frame, setFrame] = useState<ImageData | null>(null)
  const [mask, setMask] = useState<Uint8Array | null>(null)
  const [points, setPoints] = useState<PromptPoint[]>([])
  const [currentFrame, setCurrentFrame] = useState(0)
  const [cacheBytes, setCacheBytes] = useState(0)
  const [promptMode, setPromptMode] = useState<PromptLabel>(1)
  const [maskOpacity, setMaskOpacity] = useState(0.46)
  const [trackDirection, setTrackDirection] = useState<TrackDirection>('both')
  const [phase, setPhase] = useState<StudioPhase>('empty')
  const [status, setStatus] = useState(EMPTY_MESSAGE)
  const [error, setError] = useState('')
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
  const [backend, setBackend] = useState<ComputeBackend>(() =>
    'gpu' in navigator ? 'webgpu' : 'wasm',
  )
  const [trackProgress, setTrackProgress] = useState({ done: 0, total: 0 })
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 })
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const busy = ['loading-model', 'segmenting', 'tracking', 'exporting'].includes(phase)
  const generatedMaskCount = useMemo(
    () => frameStates.filter((state) => state !== 'empty').length,
    [frameStates],
  )
  const currentTime = clip ? currentFrame / clip.analysisFps : 0
  const cacheRatio = Math.min(1, cacheBytes / MASK_CACHE_LIMIT_BYTES)
  const durationRatio = clip ? clip.duration / MAX_CLIP_SECONDS : 0
  const computeLabel = modelReady
    ? backend === 'webgpu'
      ? 'WebGPU active'
      : 'CPU / WASM active'
    : gpuAvailable === null
      ? 'Checking compute…'
      : gpuAvailable
        ? 'WebGPU available'
        : 'CPU / WASM'

  useEffect(() => {
    const sam = samRef.current!
    sam.onProgress(setModelProgress)
    storageRef.current!
      .latestSnapshot()
      .then((snapshot) => setRecovery(snapshot))
      .catch(() => setRecovery(null))
    return () => {
      readerRef.current?.close()
      sam.dispose()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const inspectGpu = async () => {
      if (!('gpu' in navigator)) {
        setGpuAvailable(false)
        return
      }
      try {
        const adapter = await (navigator as Navigator & {
          gpu: { requestAdapter: () => Promise<unknown | null> }
        }).gpu.requestAdapter()
        if (!cancelled) setGpuAvailable(Boolean(adapter))
      } catch {
        if (!cancelled) setGpuAvailable(false)
      }
    }
    void inspectGpu()
    return () => {
      cancelled = true
    }
  }, [])

  const saveSnapshot = useCallback(
    async (nextStates: FrameState[], nextCacheBytes: number) => {
      if (!clip) return
      await storageRef.current!.saveSnapshot({
        clip,
        frameStates: nextStates,
        cacheBytes: nextCacheBytes,
        updatedAt: Date.now(),
      })
    },
    [clip],
  )

  const setFailure = (caught: unknown) => {
    const message = caught instanceof Error ? caught.message : 'Something went wrong.'
    setError(message)
    setStatus(`${message} Review the details and try again.`)
    setPhase('error')
  }

  const readStoredMask = useCallback(async (targetFrame: number, targetClip: ClipMetadata) => {
    const blob = await storageRef.current!.getMask(targetClip.id, targetFrame)
    if (!blob) return null
    return maskBlobToPixels(blob, targetClip.workingWidth, targetClip.workingHeight)
  }, [])

  const loadFrame = useCallback(
    async (targetFrame: number) => {
      if (!clip || busy) return
      const bounded = Math.max(0, Math.min(clip.frameCount - 1, targetFrame))
      annotationsRef.current.set(currentFrame, points)
      setError('')
      setStatus(`Reading frame ${bounded + 1} locally…`)
      try {
        const [nextFrame, nextMask] = await Promise.all([
          readerRef.current!.readFrame(bounded),
          readStoredMask(bounded, clip),
        ])
        setCurrentFrame(bounded)
        setFrame(nextFrame)
        setMask(nextMask)
        setPoints(annotationsRef.current.get(bounded) ?? [])
        sessionStorage.setItem('isolate-current-frame', String(bounded))
        setStatus(nextMask ? 'Stored mask restored for this frame.' : 'Frame ready for prompt points.')
        setPhase('ready')
      } catch (caught) {
        setFailure(caught)
      }
    },
    [busy, clip, currentFrame, points, readStoredMask],
  )

  const openClip = async (file: File) => {
    setError('')
    setStatus('Inspecting clip metadata locally…')
    setPhase('ready')
    try {
      if (!file.type.startsWith('video/')) throw new Error('Choose a video file to begin.')
      const recoverySnapshot = recovery && clipBaseName(file.name) === recovery.clip.name ? recovery : null
      const metadata = await readerRef.current!.open(
        file,
        recoverySnapshot
          ? { id: recoverySnapshot.clip.id, createdAt: recoverySnapshot.clip.createdAt }
          : undefined,
      )
      const validationError = validateClip(file, metadata.duration)
      if (validationError) {
        readerRef.current!.close()
        throw new Error(validationError)
      }
      const exactRecovery = Boolean(
        recoverySnapshot &&
          Math.abs(metadata.duration - recoverySnapshot.clip.duration) < 0.05 &&
          metadata.width === recoverySnapshot.clip.width &&
          metadata.height === recoverySnapshot.clip.height,
      )
      if (!exactRecovery && recovery) {
        await storageRef.current!.clearProject(recovery.clip.id)
        metadata.id = crypto.randomUUID()
        metadata.createdAt = Date.now()
      }
      const nextStates = exactRecovery
        ? Array.from(
            { length: metadata.frameCount },
            (_, index) => recoverySnapshot!.frameStates[index] ?? 'empty',
          )
        : Array.from({ length: metadata.frameCount }, () => 'empty' as FrameState)
      const nextCache = exactRecovery ? recoverySnapshot!.cacheBytes : 0
      setClip(metadata)
      setFrameStates(nextStates)
      setCacheBytes(nextCache)
      setCurrentFrame(0)
      setPoints([])
      annotationsRef.current.clear()
      const [firstFrame, firstMask] = await Promise.all([
        readerRef.current!.readFrame(0),
        exactRecovery ? readStoredMask(0, metadata) : Promise.resolve(null),
      ])
      setFrame(firstFrame)
      setMask(firstMask)
      const snapshot = {
        clip: metadata,
        frameStates: nextStates,
        cacheBytes: nextCache,
        updatedAt: Date.now(),
      }
      await storageRef.current!.saveSnapshot(snapshot)
      setRecovery(snapshot)
      sessionStorage.setItem('isolate-project-id', metadata.id)
      sessionStorage.setItem('isolate-current-frame', '0')
      setStatus(
        exactRecovery
          ? `${generatedMaskCount || nextStates.filter((state) => state !== 'empty').length} local masks reconnected.`
          : 'Clip admitted. Add one or more subject points.',
      )
      setPhase('ready')
    } catch (caught) {
      setFailure(caught)
    }
  }

  const ensureModel = async () => {
    if (modelReady) return backend
    setPhase('loading-model')
    setStatus('Loading the local SAM2 model. The first run downloads it to browser cache.')
    const activeBackend = await samRef.current!.initialize('gpu' in navigator ? 'webgpu' : 'wasm')
    setBackend(activeBackend)
    setModelReady(true)
    setModelProgress(null)
    return activeBackend
  }

  const storeResult = async (
    frameIndex: number,
    result: PredictionResult,
    states: FrameState[],
    currentCache: number,
    state: FrameState,
  ) => {
    const nextCache = await storageRef.current!.putMask(
      clip!.id,
      frameIndex,
      result.maskBlob,
      currentCache,
    )
    states[frameIndex] = state
    return nextCache
  }

  const runPrediction = async () => {
    if (!clip || !frame || !points.some((point) => point.label === 1)) {
      setError('Add at least one subject point on the frame first.')
      return null
    }
    setError('')
    try {
      await ensureModel()
      setPhase('segmenting')
      setStatus('SAM2 is encoding this frame on your device…')
      const result = await samRef.current!.predict(`${clip.id}:${currentFrame}`, frame, points)
      const nextStates = [...frameStates]
      const nextState: FrameState = nextStates[currentFrame] === 'tracked' ? 'corrected' : 'seed'
      const nextCache = await storeResult(
        currentFrame,
        result,
        nextStates,
        cacheBytes,
        nextState,
      )
      setMask(result.mask)
      setFrameStates(nextStates)
      setCacheBytes(nextCache)
      annotationsRef.current.set(currentFrame, points)
      await saveSnapshot(nextStates, nextCache)
      setStatus(`Mask ready in ${(result.elapsedMs / 1000).toFixed(1)}s · confidence ${Math.round(result.score * 100)}%.`)
      setPhase('ready')
      return result
    } catch (caught) {
      setFailure(caught)
      return null
    }
  }

  const trackRange = async (
    indices: number[],
    seedMask: Uint8Array,
    nextStates: FrameState[],
    startingCache: number,
    negatives: PromptPoint[],
    completedBefore: number,
    total: number,
    activeBackend: ComputeBackend,
  ) => {
    let previousMask = seedMask
    let nextCache = startingCache
    let completed = completedBefore
    for (const frameIndex of indices) {
      if (cancelTrackingRef.current) break
      const nextFrame = await readerRef.current!.readFrame(frameIndex)
      const propagatedPoints = pointsFromMask(
        previousMask,
        nextFrame.width,
        nextFrame.height,
        negatives,
      )
      const result = await samRef.current!.predict(
        `${clip!.id}:${frameIndex}`,
        nextFrame,
        propagatedPoints,
      )
      nextCache = await storeResult(
        frameIndex,
        result,
        nextStates,
        nextCache,
        'tracked',
      )
      previousMask = result.mask
      completed += 1
      setFrameStates([...nextStates])
      setCacheBytes(nextCache)
      setTrackProgress({ done: completed, total })
      setStatus(`Tracking frame ${frameIndex + 1} of ${clip!.frameCount} on ${activeBackend.toUpperCase()}…`)
    }
    return { nextCache, completed }
  }

  const runTracking = async () => {
    if (!clip || !frame) return
    setError('')
    cancelTrackingRef.current = false
    try {
      const activeBackend = await ensureModel()
      let seedMask = mask
      let nextStates = [...frameStates]
      let nextCache = cacheBytes
      if (!seedMask) {
        if (!points.some((point) => point.label === 1)) {
          throw new Error('Create a subject mask before tracking the clip.')
        }
        setPhase('segmenting')
        const seed = await samRef.current!.predict(`${clip.id}:${currentFrame}`, frame, points)
        seedMask = seed.mask
        nextCache = await storeResult(currentFrame, seed, nextStates, nextCache, 'seed')
        setMask(seed.mask)
      }
      setPhase('tracking')
      const forward = Array.from(
        { length: clip.frameCount - currentFrame - 1 },
        (_, index) => currentFrame + index + 1,
      )
      const backward = Array.from({ length: currentFrame }, (_, index) => currentFrame - index - 1)
      const ranges =
        trackDirection === 'forward'
          ? [forward]
          : trackDirection === 'backward'
            ? [backward]
            : [forward, backward]
      const total = ranges.reduce((sum, range) => sum + range.length, 0)
      setTrackProgress({ done: 0, total })
      const negatives = points.filter((point) => point.label === 0)
      let completed = 0
      for (const range of ranges) {
        if (cancelTrackingRef.current) break
        const result = await trackRange(
          range,
          seedMask,
          nextStates,
          nextCache,
          negatives,
          completed,
          total,
          activeBackend,
        )
        nextCache = result.nextCache
        completed = result.completed
      }
      setFrameStates(nextStates)
      setCacheBytes(nextCache)
      await saveSnapshot(nextStates, nextCache)
      await readerRef.current!.readFrame(currentFrame)
      setStatus(
        cancelTrackingRef.current
          ? `Tracking stopped after ${completed} frames. Finished masks were kept.`
          : `Tracking complete. ${nextStates.filter((state) => state !== 'empty').length} masks are ready.`,
      )
      setPhase('ready')
    } catch (caught) {
      setFailure(caught)
    }
  }

  const exportCutoutVideo = async () => {
    if (!clip || generatedMaskCount === 0) return
    setError('')
    setPhase('exporting')
    setExportProgress({ done: 0, total: clip.duration })
    setStatus('Rendering the transparent WebM at the source video cadence. Keep this tab visible…')
    const controller = new AbortController()
    exportAbortRef.current = controller
    try {
      const { blob, frameRate } = await createTransparentWebm({
        clip,
        readMask: (frameIndex) => readStoredMask(frameIndex, clip),
        playSourceFrames: (onFrame, signal) =>
          readerRef.current!.playSourceFrames(onFrame, signal),
        signal: controller.signal,
        onProgress: (done, total) => {
          setExportProgress({ done, total })
          setStatus(`Encoding transparent video… ${Math.round((done / total) * 100)}%`)
        },
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${clip.name.replace(/[^a-z0-9_-]+/gi, '_')}_cutout.webm`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
      setStatus(
        `Transparent WebM downloaded · ${clip.workingWidth} × ${clip.workingHeight} · ${formatBytes(blob.size)} · ${frameRate.toFixed(2)} average fps.`,
      )
      setPhase('ready')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setStatus('Transparent video export cancelled. Stored masks were kept.')
        setPhase('ready')
      } else {
        setFailure(caught)
      }
    } finally {
      exportAbortRef.current = null
    }
  }

  const clearProject = async () => {
    if (!clip) return
    if (!confirmClear) {
      setConfirmClear(true)
      setStatus('Press “Confirm clear” to remove local masks and project metadata.')
      return
    }
    await storageRef.current!.clearProject(clip.id)
    await samRef.current!.clear()
    readerRef.current!.close()
    sessionStorage.removeItem('isolate-project-id')
    sessionStorage.removeItem('isolate-current-frame')
    annotationsRef.current.clear()
    setClip(null)
    setRecovery(null)
    setFrame(null)
    setMask(null)
    setPoints([])
    setFrameStates([])
    setCacheBytes(0)
    setCurrentFrame(0)
    setConfirmClear(false)
    setPhase('empty')
    setStatus(EMPTY_MESSAGE)
  }

  const addPoint = (point: PromptPoint) => {
    const next = [...points, point]
    setPoints(next)
    annotationsRef.current.set(currentFrame, next)
    setStatus(point.label === 1 ? 'Subject point added.' : 'Exclude point added.')
  }

  const addCenterPoint = () => {
    if (!frame) return
    addPoint({ x: Math.round(frame.width / 2), y: Math.round(frame.height / 2), label: promptMode })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !clip ||
        busy ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLCanvasElement
      ) return
      if (event.key === '[' || event.key === 'ArrowLeft') void loadFrame(currentFrame - 1)
      if (event.key === ']' || event.key === 'ArrowRight') void loadFrame(currentFrame + 1)
      if (event.key.toLowerCase() === 'a') setPromptMode(1)
      if (event.key.toLowerCase() === 'x') setPromptMode(0)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        setPoints((current) => current.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, clip, currentFrame, loadFrame])

  return (
    <main className="studio-shell">
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label="Return to Isolate home">
          <img src={isolateLogo} alt="" className="brand-mark" />
          <div>
            <strong>Isolate</strong>
            <span>Local mask studio</span>
          </div>
        </a>
        <div className="device-ledger" aria-label="Local processing status">
          <div className="ledger-item">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Private by design</span>
          </div>
          <div className="ledger-item">
            <Cpu size={16} aria-hidden="true" />
            <span>{computeLabel}</span>
          </div>
          <div className="ledger-item ledger-item-measure">
            <span>{formatTime(clip?.duration ?? 0)}</span>
            <span>of 00:20:00</span>
          </div>
        </div>
        <button className="topbar-action" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={17} aria-hidden="true" />
          {clip ? 'Replace clip' : 'Open clip'}
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="video/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void openClip(file)
            event.currentTarget.value = ''
          }}
        />
      </header>

      <section className="workspace">
        <div className="viewer-column">
          <section
            className={`viewer-stage ${dragActive ? 'is-dragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              const file = event.dataTransfer.files[0]
              if (file) void openClip(file)
            }}
          >
            {clip && frame ? (
              <>
                <div className="viewer-meta">
                  <span>{clip.name}</span>
                  <span>
                    {clip.workingWidth} × {clip.workingHeight} · frame {currentFrame + 1}/{clip.frameCount}
                  </span>
                </div>
                <div className="canvas-wrap">
                  <CanvasViewer
                    key={clip.id}
                    frame={frame}
                    mask={mask}
                    points={points}
                    opacity={maskOpacity}
                    promptMode={promptMode}
                    disabled={busy}
                    onPoint={addPoint}
                  />
                </div>
                {phase === 'loading-model' && (
                  <div className="model-loader" role="status" aria-live="polite">
                    <div className="loader-copy">
                      <Layers3 size={21} aria-hidden="true" />
                      <div>
                        <strong>{modelFileLabel(modelProgress)}</strong>
                        <span>Downloaded once, then cached by this browser</span>
                      </div>
                    </div>
                    <div className="loader-track" aria-label={`${progressPercent(modelProgress)} percent loaded`}>
                      <span style={{ width: `${Math.max(4, progressPercent(modelProgress))}%` }} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="import-state">
                <div className="import-copy">
                  <img src={isolateLogo} alt="Isolate" className="import-mark" />
                  <h1>Cut the subject.<br />Keep the footage.</h1>
                  <p>
                    Open a clip and build alpha masks entirely on this device. Your video is never uploaded to Vercel—or anywhere else.
                  </p>
                  <button className="primary-action" type="button" onClick={() => inputRef.current?.click()}>
                    <Upload size={18} aria-hidden="true" />
                    Choose a local clip
                  </button>
                  <span className="drop-note">or drop a video here · 20 seconds / 500 MB maximum</span>
                  {error && <div className="import-error" role="alert">{error}</div>}
                </div>
                <div className="admission-spec" aria-label="Clip limits">
                  <div><strong>20s</strong><span>hard duration limit</span></div>
                  <div><strong>2K</strong><span>inference / output ceiling</span></div>
                  <div><strong>64MB</strong><span>mask cache ceiling</span></div>
                </div>
                {recovery && (
                  <div className="recovery-note">
                    <RotateCcw size={18} aria-hidden="true" />
                    <div>
                      <strong>{recovery.clip.name} has local masks</strong>
                      <span>Choose the same source clip to reconnect this session.</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="timeline-panel" aria-label="Frame timeline">
            <div className="transport-row">
              <div className="transport-controls">
                <button
                  className="icon-button"
                  type="button"
                  title="Previous frame ([)"
                  aria-label="Previous frame"
                  disabled={!clip || busy || currentFrame === 0}
                  onClick={() => void loadFrame(currentFrame - 1)}
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <button
                  className="play-button"
                  type="button"
                  disabled={!clip || busy}
                  onClick={() => void loadFrame(currentFrame + 1)}
                >
                  <Play size={15} fill="currentColor" aria-hidden="true" />
                  Step frame
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Next frame (])"
                  aria-label="Next frame"
                  disabled={!clip || busy || currentFrame >= (clip?.frameCount ?? 1) - 1}
                  onClick={() => void loadFrame(currentFrame + 1)}
                >
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="timecode">
                <strong>{formatTime(currentTime)}</strong>
                <span>{clip ? `${clip.analysisFps} analysis fps` : 'No clip loaded'}</span>
              </div>
              <div className="timeline-key" aria-label="Timeline legend">
                <span><i className="key-seed" /> Prompted</span>
                <span><i className="key-tracked" /> Tracked</span>
                <span><i className="key-corrected" /> Corrected</span>
              </div>
            </div>
            <div className="frame-capacity-map">
              <div className="map-heading">
                <span>Frame / capacity map</span>
                <span>{clip ? `${clip.duration.toFixed(1)}s admitted` : 'No footage'} · hard stop 20.0s</span>
              </div>
              <div className="frame-rail" aria-label="Processed frame and footage capacity map">
                <div
                  className="frame-span"
                  style={{ width: frameStates.length ? `${Math.max(2, durationRatio * 100)}%` : '100%' }}
                >
                  {frameStates.length ? (
                    frameStates.map((state, index) => (
                      <button
                        key={index}
                        className={`frame-tick state-${state} ${index === currentFrame ? 'is-current' : ''}`}
                        type="button"
                        title={`Frame ${index + 1}: ${frameStateLabel(state)}`}
                        aria-label={`Frame ${index + 1}: ${frameStateLabel(state)}`}
                        aria-current={index === currentFrame ? 'true' : undefined}
                        disabled={busy}
                        onClick={() => void loadFrame(index)}
                      />
                    ))
                  ) : (
                    Array.from({ length: 48 }, (_, index) => <span className="frame-tick-placeholder" key={index} />)
                  )}
                </div>
                <span className="hard-endpoint" aria-hidden="true" />
              </div>
            </div>
            <div className="capacity-strip">
              <div className="capacity-block">
                <span><Gauge size={14} aria-hidden="true" /> Footage</span>
                <div className="capacity-meter"><i style={{ width: `${durationRatio * 100}%` }} /></div>
                <strong>{clip ? `${clip.duration.toFixed(1)}s` : '0.0s'} / 20s</strong>
              </div>
              <div className="capacity-block">
                <span><HardDrive size={14} aria-hidden="true" /> Masks</span>
                <div className="capacity-meter capacity-cache"><i style={{ width: `${cacheRatio * 100}%` }} /></div>
                <strong>{formatBytes(cacheBytes)} / 64 MB</strong>
              </div>
            </div>
          </section>
        </div>

        <aside className="inspector">
          <div className="inspector-heading">
            <div>
              <h2>{clip ? 'Prompt the subject' : 'Local workflow'}</h2>
              <p>{clip ? 'Mark what stays in the matte.' : 'A private four-step pass.'}</p>
            </div>
            {clip && (
              <span className={`frame-status state-${frameStates[currentFrame] ?? 'empty'}`}>
                {frameStateLabel(frameStates[currentFrame] ?? 'empty')}
              </span>
            )}
          </div>

          {clip ? (
            <>
              <section className="inspector-section">
                <div className="segmented-control" aria-label="Prompt mode">
                  <button
                    type="button"
                    className={promptMode === 1 ? 'is-active' : ''}
                    aria-pressed={promptMode === 1}
                    onClick={() => setPromptMode(1)}
                    disabled={busy}
                  >
                    <CirclePlus size={17} aria-hidden="true" /> Subject <kbd>A</kbd>
                  </button>
                  <button
                    type="button"
                    className={promptMode === 0 ? 'is-active is-exclude' : ''}
                    aria-pressed={promptMode === 0}
                    onClick={() => setPromptMode(0)}
                    disabled={busy}
                  >
                    <CircleMinus size={17} aria-hidden="true" /> Exclude <kbd>X</kbd>
                  </button>
                </div>
                <p className="field-help">
                  Click the frame to place a point. Scroll to zoom; while zoomed, hold Space and drag to pan. Keyboard: move with arrows, then press Enter. Right-click always excludes.
                </p>
                <div className="point-ledger">
                  <div><span>Subject</span><strong>{points.filter((point) => point.label === 1).length}</strong></div>
                  <div><span>Exclude</span><strong>{points.filter((point) => point.label === 0).length}</strong></div>
                  <div><span>Mask</span><strong>{mask ? 'ready' : 'open'}</strong></div>
                </div>
                <div className="inline-actions">
                  <button type="button" className="text-button" onClick={addCenterPoint} disabled={busy || !frame}>
                    <MousePointer2 size={15} aria-hidden="true" /> Add center point
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setPoints((current) => current.slice(0, -1))}
                    disabled={busy || points.length === 0}
                  >
                    <RotateCcw size={15} aria-hidden="true" /> Undo point
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setPoints([])}
                    disabled={busy || points.length === 0}
                  >
                    <X size={15} aria-hidden="true" /> Clear
                  </button>
                </div>
              </section>

              <section className="inspector-section">
                <label className="range-label" htmlFor="mask-opacity">
                  <span>Mask overlay</span>
                  <strong>{Math.round(maskOpacity * 100)}%</strong>
                </label>
                <input
                  id="mask-opacity"
                  type="range"
                  min="0.1"
                  max="0.85"
                  step="0.05"
                  value={maskOpacity}
                  onChange={(event) => setMaskOpacity(Number(event.target.value))}
                />
                <button
                  className="primary-action full-width"
                  type="button"
                  onClick={() => void runPrediction()}
                  disabled={busy || !points.some((point) => point.label === 1)}
                >
                  <ScanLine size={18} aria-hidden="true" />
                  {mask ? 'Refine this mask' : 'Create mask'}
                </button>
              </section>

              <section className="inspector-section">
                <h3>Propagate through clip</h3>
                <div className="direction-control" aria-label="Tracking direction">
                  {(['backward', 'both', 'forward'] as TrackDirection[]).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      className={trackDirection === direction ? 'is-active' : ''}
                      aria-pressed={trackDirection === direction}
                      disabled={busy}
                      onClick={() => setTrackDirection(direction)}
                    >
                      {direction}
                    </button>
                  ))}
                </div>
                {phase === 'tracking' ? (
                  <button
                    className="danger-action full-width"
                    type="button"
                    onClick={() => {
                      cancelTrackingRef.current = true
                      setStatus('Stopping after the current frame…')
                    }}
                  >
                    <Pause size={17} aria-hidden="true" /> Stop after this frame
                  </button>
                ) : (
                  <button
                    className="secondary-action full-width"
                    type="button"
                    onClick={() => void runTracking()}
                    disabled={busy || (!mask && !points.some((point) => point.label === 1))}
                  >
                    <Play size={17} fill="currentColor" aria-hidden="true" /> Track {trackDirection}
                  </button>
                )}
                {trackProgress.total > 0 && (
                  <div className="track-meter" aria-label={`Tracked ${trackProgress.done} of ${trackProgress.total} frames`}>
                    <span style={{ width: `${(trackProgress.done / trackProgress.total) * 100}%` }} />
                  </div>
                )}
                <p className="field-help">Each frame is processed sequentially so decoded video never accumulates in memory.</p>
              </section>

              <section className="inspector-section export-section">
                <div className="export-summary">
                  <Film size={20} aria-hidden="true" />
                  <div>
                    <strong>Transparent WebM</strong>
                    <span>
                      {clip.workingWidth} × {clip.workingHeight} · {generatedMaskCount}/{clip.frameCount} masks · silent · source cadence
                    </span>
                  </div>
                </div>
                {phase === 'exporting' ? (
                  <button
                    className="danger-action full-width"
                    type="button"
                    onClick={() => exportAbortRef.current?.abort()}
                  >
                    <Pause size={17} aria-hidden="true" /> Stop video export
                  </button>
                ) : (
                  <button
                    className="export-action full-width"
                    type="button"
                    onClick={() => void exportCutoutVideo()}
                    disabled={busy || generatedMaskCount === 0}
                  >
                    <Download size={17} aria-hidden="true" /> Download transparent WebM
                  </button>
                )}
                {exportProgress.total > 0 && (
                  <div className="track-meter" aria-label={`Encoded ${exportProgress.done} of ${exportProgress.total} frames`}>
                    <span style={{ width: `${(exportProgress.done / exportProgress.total) * 100}%` }} />
                  </div>
                )}
                <p className="field-help">Original color and source frame cadence are retained. The nearest stored mask is applied to each source frame.</p>
              </section>

              <button
                className={`clear-action ${confirmClear ? 'is-confirming' : ''}`}
                type="button"
                onClick={() => void clearProject()}
                disabled={busy}
              >
                <Trash2 size={15} aria-hidden="true" /> {confirmClear ? 'Confirm clear' : 'Clear local project'}
              </button>
            </>
          ) : (
            <ol className="workflow-list">
              <li><span><Upload size={17} /></span><div><strong>Admit the clip</strong><p>Duration and file-size checks happen before frames are decoded.</p></div></li>
              <li><span><MousePointer2 size={17} /></span><div><strong>Mark the subject</strong><p>Positive and negative points guide SAM2 on the active frame.</p></div></li>
              <li><span><ScanLine size={17} /></span><div><strong>Carry the mask</strong><p>Frames run sequentially on WebGPU or CPU/WASM.</p></div></li>
              <li><span><Download size={17} /></span><div><strong>Take the cutout</strong><p>Stored masks become the alpha channel of one transparent WebM.</p></div></li>
            </ol>
          )}
        </aside>
      </section>

      <footer className={`statusbar ${error ? 'has-error' : ''}`}>
        <div className="status-copy" role="status" aria-live="polite">
          <span className="status-indicator" />
          <span>{error || status}</span>
        </div>
        <div className="status-meta">
          <span>{modelReady ? <><Check size={13} /> SAM2 cached</> : 'SAM2 loads on first mask'}</span>
          <span>
            {modelReady
              ? backend === 'webgpu' ? 'GPU local' : 'CPU local'
              : gpuAvailable === null ? 'Checking local compute' : gpuAvailable ? 'GPU available' : 'CPU available'}
          </span>
          <span>Vercel: static only</span>
        </div>
      </footer>
    </main>
  )
}

