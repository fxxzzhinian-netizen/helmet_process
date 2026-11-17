export type MagnifierPoint = { x: number; y: number }

// 坐标均为原图实际显示尺寸；中心点使用比例，容器变化后仍保留同一查看位置。
export function magnifierGeometry(
  imageWidth: number,
  imageHeight: number,
  previewWidth: number,
  previewHeight: number,
  point: MagnifierPoint,
  zoom = 3
) {
  if (![imageWidth, imageHeight, previewWidth, previewHeight, zoom].every((n) => Number.isFinite(n) && n > 0)
      || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined
  const sourceWidth = Math.min(imageWidth, previewWidth / zoom)
  const sourceHeight = Math.min(imageHeight, previewHeight / zoom)
  const x = Math.max(0, Math.min(imageWidth - sourceWidth, point.x * imageWidth - sourceWidth / 2))
  const y = Math.max(0, Math.min(imageHeight - sourceHeight, point.y * imageHeight - sourceHeight / 2))
  return { x, y, sourceWidth, sourceHeight, width: imageWidth * zoom, height: imageHeight * zoom,
    translateX: -x * zoom, translateY: -y * zoom }
}

// 选区与方形预览分开放在原图可见范围内；空间不足时缩小预览，不遮住选区。
export function inlineMagnifierGeometry(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  scrollLeft: number,
  scrollTop: number,
  point: MagnifierPoint,
  zoom = 3
) {
  if (![imageWidth, imageHeight, viewportWidth, viewportHeight].every((n) => Number.isFinite(n) && n > 0)
      || ![scrollLeft, scrollTop].every(Number.isFinite)) return undefined
  const padding = 8
  const visibleLeft = Math.max(0, Math.min(imageWidth, scrollLeft))
  const visibleTop = Math.max(0, Math.min(imageHeight, scrollTop))
  const visibleRight = Math.min(imageWidth, visibleLeft + viewportWidth)
  const visibleBottom = Math.min(imageHeight, visibleTop + viewportHeight)
  const maxSize = Math.min(288, visibleRight - visibleLeft - padding * 2, visibleBottom - visibleTop - padding * 2)
  if (maxSize < 48) return undefined
  const gap = 16
  type Side = 'right' | 'left' | 'below' | 'above'
  function candidate(size: number, side: Side) {
    const enlarged = magnifierGeometry(imageWidth, imageHeight, size, size, point, zoom)
    if (!enlarged) return undefined
    const left = side === 'right' ? visibleRight - size - padding : side === 'left' ? visibleLeft + padding
      : Math.max(visibleLeft + padding, Math.min(visibleRight - size - padding, point.x * imageWidth - size / 2))
    const top = side === 'below' ? visibleBottom - size - padding : side === 'above' ? visibleTop + padding
      : Math.max(visibleTop + padding, Math.min(visibleBottom - size - padding, point.y * imageHeight - size / 2))
    const fits = side === 'right' ? left >= enlarged.x + enlarged.sourceWidth + gap
      : side === 'left' ? left + size + gap <= enlarged.x
        : side === 'below' ? top >= enlarged.y + enlarged.sourceHeight + gap
          : top + size + gap <= enlarged.y
    return { ...enlarged, size, left, top, fits }
  }
  let best: ReturnType<typeof candidate>
  for (const side of ['right', 'left', 'below', 'above'] as const) {
    let placed = candidate(maxSize, side)
    if (!placed) return undefined
    if (!placed.fits) {
      let lower = 0, upper = maxSize
      // 每个方向的最大可用尺寸，保证窗口与选区至少相隔 gap。
      for (let step = 0; step < 18; step++) {
        const middle = (lower + upper) / 2
        if (candidate(middle, side)?.fits) lower = middle
        else upper = middle
      }
      placed = candidate(lower, side)
    }
    if (placed?.fits && placed.size >= 48 && (!best || placed.size > best.size + .5)) best = placed
    if (best?.size === maxSize) break
  }
  return best
}
