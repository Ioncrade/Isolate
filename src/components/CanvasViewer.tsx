import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PromptLabel, PromptPoint } from '../types'
import {
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  clampViewPan,
  clampViewZoom,
  zoomAroundPoint,
} from '../lib/viewport'

interface CanvasViewerProps {
  frame: ImageData | null
  mask: Uint8Array | null
  points: PromptPoint[]
  opacity: number
  promptMode: PromptLabel
  disabled?: boolean
  onPoint: (point: PromptPoint) => void
}

interface ViewState {
  zoom: number
  x: number
  y: number
}

const DEFAULT_VIEW: ViewState = { zoom: 1, x: 0, y: 0 }

export function CanvasViewer({
  frame,
  mask,
  points,
  opacity,
  promptMode,
  disabled,
  onPoint,
}: CanvasViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerInsideRef = useRef(false)
  const panGestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const [keyboardCursor, setKeyboardCursor] = useState<{ x: number; y: number } | null>(null)
  const [focused, setFocused] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW)

  const constrainView = useCallback((candidate: ViewState): ViewState => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return candidate
    const pan = clampViewPan(
      candidate,
      candidate.zoom,
      canvas.offsetWidth,
      canvas.offsetHeight,
      viewport.clientWidth,
      viewport.clientHeight,
    )
    return { zoom: candidate.zoom, ...pan }
  }, [])

  const setZoom = useCallback((requestedZoom: number, anchor = { x: 0, y: 0 }) => {
    setView((current) => {
      const zoom = clampViewZoom(requestedZoom)
      if (Math.abs(zoom - current.zoom) < 0.001) return current
      const pan = zoomAroundPoint(current, current.zoom, zoom, anchor)
      return constrainView({ zoom, ...pan })
    })
  }, [constrainView])

  const resetView = useCallback(() => {
    panGestureRef.current = null
    setPanning(false)
    setSpaceHeld(false)
    setView(DEFAULT_VIEW)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    canvas.width = frame.width
    canvas.height = frame.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.putImageData(frame, 0, 0)

    if (mask && mask.length === frame.width * frame.height) {
      const overlay = new Uint8ClampedArray(mask.length * 4)
      for (let pixel = 0; pixel < mask.length; pixel += 1) {
        if (!mask[pixel]) continue
        const offset = pixel * 4
        overlay[offset] = 49
        overlay[offset + 1] = 91
        overlay[offset + 2] = 255
        overlay[offset + 3] = Math.round(255 * opacity)
      }
      const layer = document.createElement('canvas')
      layer.width = frame.width
      layer.height = frame.height
      layer.getContext('2d')?.putImageData(new ImageData(overlay, frame.width, frame.height), 0, 0)
      context.drawImage(layer, 0, 0)
    }

    for (const point of points) {
      const radius = Math.max(5, frame.width / 120)
      context.save()
      context.translate(point.x, point.y)
      context.beginPath()
      context.arc(0, 0, radius, 0, Math.PI * 2)
      context.fillStyle = point.label === 1 ? '#315bff' : '#e85d3f'
      context.fill()
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(2, frame.width / 480)
      context.stroke()
      context.beginPath()
      context.moveTo(-radius * 0.45, 0)
      context.lineTo(radius * 0.45, 0)
      if (point.label === 1) {
        context.moveTo(0, -radius * 0.45)
        context.lineTo(0, radius * 0.45)
      }
      context.strokeStyle = '#ffffff'
      context.lineCap = 'round'
      context.stroke()
      context.restore()
    }

    if (focused && keyboardCursor) {
      const radius = Math.max(9, frame.width / 80)
      context.save()
      context.translate(keyboardCursor.x, keyboardCursor.y)
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(2, frame.width / 480)
      context.setLineDash([radius * 0.45, radius * 0.3])
      context.beginPath()
      context.arc(0, 0, radius, 0, Math.PI * 2)
      context.stroke()
      context.setLineDash([])
      context.strokeStyle = promptMode === 1 ? '#315bff' : '#d94f34'
      context.beginPath()
      context.moveTo(-radius * 1.35, 0)
      context.lineTo(radius * 1.35, 0)
      context.moveTo(0, -radius * 1.35)
      context.lineTo(0, radius * 1.35)
      context.stroke()
      context.restore()
    }
  }, [focused, frame, keyboardCursor, mask, opacity, points, promptMode])

  useEffect(() => {
    if (!frame) {
      setKeyboardCursor(null)
      resetView()
      return
    }
    setKeyboardCursor({ x: Math.round(frame.width / 2), y: Math.round(frame.height / 2) })
  }, [frame, resetView])

  useEffect(() => {
    const onResize = () => setView((current) => constrainView(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [constrainView])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !frame) return
    const onWheel = (event: WheelEvent) => {
      if (disabled) return
      event.preventDefault()
      const bounds = viewport.getBoundingClientRect()
      const anchor = {
        x: event.clientX - (bounds.left + bounds.width / 2),
        y: event.clientY - (bounds.top + bounds.height / 2),
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1
      const factor = Math.exp(-event.deltaY * unit * 0.0015)
      setView((current) => {
        const zoom = clampViewZoom(current.zoom * factor)
        if (Math.abs(zoom - current.zoom) < 0.001) return current
        const pan = zoomAroundPoint(current, current.zoom, zoom, anchor)
        return constrainView({ zoom, ...pan })
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [constrainView, disabled, frame])

  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
    const canUseCanvas = () => pointerInsideRef.current || document.activeElement === canvasRef.current
    const releasePanMode = () => {
      setSpaceHeld(false)
      setPanning(false)
      panGestureRef.current = null
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || disabled || !canUseCanvas()) return
      if (isEditable(event.target) && event.target !== canvasRef.current) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') releasePanMode()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releasePanMode)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releasePanMode)
    }
  }, [disabled])

  const addPoint = (clientX: number, clientY: number, label: PromptLabel) => {
    const canvas = canvasRef.current
    if (!canvas || !frame || disabled) return
    const bounds = canvas.getBoundingClientRect()
    const x = ((clientX - bounds.left) / bounds.width) * frame.width
    const y = ((clientY - bounds.top) / bounds.height) * frame.height
    onPoint({
      x: Math.max(0, Math.min(frame.width - 1, Math.round(x))),
      y: Math.max(0, Math.min(frame.height - 1, Math.round(y))),
      label,
    })
  }

  const beginPointerAction = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || disabled) return
    if (spaceHeld && view.zoom > MIN_VIEW_ZOOM) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      setPanning(true)
      return
    }
    addPoint(event.clientX, event.clientY, promptMode)
  }

  const movePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const deltaX = event.clientX - gesture.x
    const deltaY = event.clientY - gesture.y
    gesture.x = event.clientX
    gesture.y = event.clientY
    setView((current) => constrainView({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY,
    }))
  }

  const endPointerAction = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = panGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panGestureRef.current = null
    setPanning(false)
  }

  const zoomPercent = Math.round(view.zoom * 100)

  return (
    <div
      ref={viewportRef}
      className={`canvas-viewport ${spaceHeld && view.zoom > 1 ? 'is-pan-ready' : ''} ${panning ? 'is-panning' : ''}`}
      onPointerEnter={() => {
        pointerInsideRef.current = true
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false
      }}
    >
      <canvas
        ref={canvasRef}
        className="frame-canvas"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}
        tabIndex={disabled ? -1 : 0}
        draggable={false}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter"
        aria-label={`Video frame at ${zoomPercent} percent zoom. Scroll to zoom. While zoomed, hold Space and drag to pan. Use arrow keys to move the annotation cursor and Enter to add a ${promptMode === 1 ? 'subject' : 'exclude'} point.`}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (!frame || disabled) return
          const cursor = keyboardCursor ?? { x: Math.round(frame.width / 2), y: Math.round(frame.height / 2) }
          const step = Math.max(1, Math.round(Math.max(frame.width, frame.height) / 80)) * (event.shiftKey ? 5 : 1)
          if (event.key === 'Enter') {
            event.preventDefault()
            onPoint({ ...cursor, label: promptMode })
            return
          }
          if (event.code === 'Space') {
            event.preventDefault()
            return
          }
          const delta = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[event.key]
          if (!delta) return
          event.preventDefault()
          setKeyboardCursor({
            x: Math.max(0, Math.min(frame.width - 1, cursor.x + delta[0])),
            y: Math.max(0, Math.min(frame.height - 1, cursor.y + delta[1])),
          })
        }}
        onPointerDown={beginPointerAction}
        onPointerMove={movePointer}
        onPointerUp={endPointerAction}
        onPointerCancel={endPointerAction}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!spaceHeld) addPoint(event.clientX, event.clientY, 0)
        }}
      />

      <div className="canvas-view-controls" role="group" aria-label="Canvas zoom controls">
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={disabled || view.zoom <= MIN_VIEW_ZOOM}
          onClick={() => setZoom(view.zoom / 1.25)}
        >
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <output aria-label={`Zoom ${zoomPercent} percent`}>{zoomPercent}%</output>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={disabled || view.zoom >= MAX_VIEW_ZOOM}
          onClick={() => setZoom(view.zoom * 1.25)}
        >
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Reset view"
          aria-label="Reset zoom and position"
          disabled={disabled || view.zoom <= MIN_VIEW_ZOOM}
          onClick={resetView}
        >
          <Maximize2 size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="canvas-view-hint" aria-hidden="true">
        {view.zoom > MIN_VIEW_ZOOM ? 'Hold Space + drag to pan' : 'Scroll to zoom'}
      </div>
    </div>
  )
}
