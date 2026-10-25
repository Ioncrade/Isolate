export const MIN_VIEW_ZOOM = 1
export const MAX_VIEW_ZOOM = 8

export interface ViewOffset {
  x: number
  y: number
}

export interface ViewSize {
  width: number
  height: number
}

export function containViewSize(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewSize {
  if (
    contentWidth <= 0 ||
    contentHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { width: 0, height: 0 }
  }
  const scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight)
  return {
    width: contentWidth * scale,
    height: contentHeight * scale,
  }
}

export function clampViewZoom(zoom: number) {
  return Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, zoom))
}

export function zoomAroundPoint(
  pan: ViewOffset,
  currentZoom: number,
  nextZoom: number,
  anchor: ViewOffset,
): ViewOffset {
  const ratio = nextZoom / currentZoom
  return {
    x: anchor.x - (anchor.x - pan.x) * ratio,
    y: anchor.y - (anchor.y - pan.y) * ratio,
  }
}

export function clampViewPan(
  pan: ViewOffset,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewOffset {
  if (zoom <= MIN_VIEW_ZOOM) return { x: 0, y: 0 }
  const maxX = Math.max(0, (canvasWidth * zoom - viewportWidth) / 2)
  const maxY = Math.max(0, (canvasHeight * zoom - viewportHeight) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  }
}
