"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ChatTimelineRow } from "@/lib/chat-engine-v2/rowModel"

export type MeasuredVirtualItem = {
  index: number
  row: ChatTimelineRow
  start: number
  size: number
}

const DEFAULT_OVERSCAN = 10

export function useMeasuredVirtualRows({
  rows,
  scrollElement,
  enabled,
  overscan = DEFAULT_OVERSCAN,
}: {
  rows: ChatTimelineRow[]
  scrollElement: HTMLElement | null
  enabled: boolean
  overscan?: number
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map<string, number>())

  useEffect(() => {
    if (!scrollElement || !enabled) return
    const update = () => {
      setScrollTop(scrollElement.scrollTop)
      setViewportHeight(scrollElement.clientHeight)
    }
    update()
    scrollElement.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
    observer?.observe(scrollElement)
    return () => {
      scrollElement.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      observer?.disconnect()
    }
  }, [enabled, scrollElement])

  const sizes = useMemo(
    () => rows.map((row) => measuredHeights.get(row.rowId) ?? row.heightEstimate),
    [measuredHeights, rows]
  )

  const offsets = useMemo(() => {
    const next: number[] = new Array(rows.length)
    let offset = 0
    for (let index = 0; index < rows.length; index += 1) {
      next[index] = offset
      offset += sizes[index] ?? rows[index]?.heightEstimate ?? 120
    }
    return next
  }, [rows, sizes])

  const totalSize = useMemo(() => {
    if (rows.length === 0) return 0
    const lastIndex = rows.length - 1
    return (offsets[lastIndex] ?? 0) + (sizes[lastIndex] ?? rows[lastIndex]?.heightEstimate ?? 0)
  }, [offsets, rows, sizes])

  const virtualItems = useMemo((): MeasuredVirtualItem[] => {
    if (!enabled) {
      return rows.map((row, index) => ({ index, row, start: offsets[index] ?? 0, size: sizes[index] ?? row.heightEstimate }))
    }
    const startPx = Math.max(0, scrollTop - viewportHeight)
    const endPx = scrollTop + viewportHeight * 2
    let first = 0
    while (first < rows.length - 1 && (offsets[first] ?? 0) + (sizes[first] ?? rows[first]!.heightEstimate) < startPx) first += 1
    let last = first
    while (last < rows.length - 1 && (offsets[last] ?? 0) <= endPx) last += 1
    first = Math.max(0, first - overscan)
    last = Math.min(rows.length - 1, last + overscan)
    const items: MeasuredVirtualItem[] = []
    for (let index = first; index <= last; index += 1) {
      const row = rows[index]
      if (!row) continue
      items.push({ index, row, start: offsets[index] ?? 0, size: sizes[index] ?? row.heightEstimate })
    }
    return items
  }, [enabled, offsets, overscan, rows, scrollTop, sizes, viewportHeight])

  const measureElement = useCallback((rowId: string, element: HTMLElement | null) => {
    if (!element || !enabled) return
    const height = Math.ceil(element.getBoundingClientRect().height)
    if (!Number.isFinite(height) || height <= 0) return
    setMeasuredHeights((current) => {
      if (current.get(rowId) === height) return current
      const next = new Map(current)
      next.set(rowId, height)
      return next
    })
  }, [enabled])

  return { totalSize, virtualItems, measureElement }
}
