export async function maskBlobToPixels(blob: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const rgba = context.getImageData(0, 0, width, height).data
  const mask = new Uint8Array(width * height)
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = rgba[pixel * 4 + 3]
  return mask
}

