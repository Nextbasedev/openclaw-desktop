"use client"

import { useEffect, useMemo } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
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
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => rows[index]?.rowId ?? index,
    estimateSize: (index) => rows[index]?.heightEstimate ?? 120,
    overscan,
    enabled: enabled && !!scrollElement,
  })

  const rowVersionSignature = useMemo(
    () => rows.map((row) => `${row.rowId}:${row.heightVersion}:${row.mutationVersion}`).join("|"),
    [rows]
  )

  useEffect(() => {
    if (!enabled) return
    virtualizer.measure()
  }, [enabled, rowVersionSignature, virtualizer])

  const virtualItems = useMemo((): MeasuredVirtualItem[] => {
    if (!enabled) {
      let offset = 0
      return rows.map((row, index) => {
        const size = row.heightEstimate
        const item = { index, row, start: offset, size }
        offset += size
        return item
      })
    }

    return virtualizer.getVirtualItems().flatMap((item) => {
      const row = rows[item.index]
      if (!row) return []
      return [{ index: item.index, row, start: item.start, size: item.size }]
    })
  }, [enabled, rows, virtualizer])

  const totalSize = enabled
    ? virtualizer.getTotalSize()
    : rows.reduce((sum, row) => sum + row.heightEstimate, 0)

  return {
    totalSize,
    virtualItems,
    measureElement: (_rowId: string, element: HTMLElement | null) => {
      virtualizer.measureElement(element as HTMLDivElement | null)
    },
    scrollToIndex: virtualizer.scrollToIndex,
  }
}
