export type VirtualRange = {
  startIndex: number
  endIndex: number
  beforeHeight: number
  totalHeight: number
}

export function estimateMessageHeight(role?: string) {
  return role === "user" ? 72 : 140
}

export function computeVirtualRange(params: {
  count: number
  scrollTop: number
  viewportHeight: number
  getHeight: (index: number) => number
  overscanPx?: number
  gapPx?: number
}): VirtualRange {
  const count = Math.max(0, params.count)
  const gapPx = params.gapPx ?? 20
  const overscanPx = params.overscanPx ?? 900
  if (count === 0)
    return { startIndex: 0, endIndex: 0, beforeHeight: 0, totalHeight: 0 }

  const offsets: number[] = new Array(count)
  let totalHeight = 0
  for (let i = 0; i < count; i++) {
    offsets[i] = totalHeight
    totalHeight += Math.max(1, params.getHeight(i))
    if (i < count - 1) totalHeight += gapPx
  }

  const from = Math.max(0, params.scrollTop - overscanPx)
  const to = Math.min(
    totalHeight,
    params.scrollTop + params.viewportHeight + overscanPx
  )

  let startIndex = 0
  let lo = 0
  let hi = count - 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const bottom = offsets[mid] + Math.max(1, params.getHeight(mid))
    if (bottom < from) {
      lo = mid + 1
    } else {
      startIndex = mid
      hi = mid - 1
    }
  }

  let endIndex = startIndex
  for (let i = startIndex; i < count; i++) {
    if (offsets[i] > to) break
    endIndex = i + 1
  }

  return {
    startIndex,
    endIndex: Math.min(count, Math.max(startIndex + 1, endIndex)),
    beforeHeight: offsets[startIndex] ?? 0,
    totalHeight,
  }
}
