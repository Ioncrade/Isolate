import type { PromptPoint } from '../types'

export function pointsFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  carryNegative: PromptPoint[],
): PromptPoint[] {
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let sumX = 0
  let sumY = 0
  let count = 0
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 480))
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (mask[y * width + x] < 128) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      sumX += x
      sumY += y
      count += 1
    }
  }
  if (!count) throw new Error('The previous frame contains no subject mask to propagate.')

  const candidates = [
    [sumX / count, sumY / count],
    [minX + (maxX - minX) * 0.35, minY + (maxY - minY) * 0.35],
    [minX + (maxX - minX) * 0.65, minY + (maxY - minY) * 0.35],
    [minX + (maxX - minX) * 0.5, minY + (maxY - minY) * 0.68],
  ]
  const positives: PromptPoint[] = []
  for (const [x, y] of candidates) {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)))
    const py = Math.max(0, Math.min(height - 1, Math.round(y)))
    if (mask[py * width + px] >= 128) positives.push({ x: px, y: py, label: 1 })
  }
  return [...positives, ...carryNegative.slice(-4)]
}

