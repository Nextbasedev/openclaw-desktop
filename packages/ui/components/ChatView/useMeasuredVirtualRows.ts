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
  overscan = DEFAULT_OVERSCAN,
}: {
  rows: ChatTimelineRow[]
  scrollElement: HTMLElement | null
  overscan?: number
}) {
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => rows[index]?.rowId ?? index,
    estimateSize: (index) => rows[index]?.heightEstimate ?? 120,
    overscan,
    enabled: !!scrollElement,
  })

  const rowVersionSignature = useMemo(
    () => rows.map((row) => `${row.rowId}:${row.heightVersion}:${row.mutationVersion}`).join("|"),
    [rows]
  )

  useEffect(() => {
    if (!scrollElement) return
    virtualizer.measure()
  }, [rowVersionSignature, scrollElement, virtualizer])

  const virtualItems = useMemo((): MeasuredVirtualItem[] => {
    return virtualizer.getVirtualItems().flatMap((item) => {
      const row = rows[item.index]
      if (!row) return []
      return [{ index: item.index, row, start: item.start, size: item.size }]
    })
  }, [rows, virtualizer])

  const totalSize = virtualizer.getTotalSize()

  return {
    totalSize,
    virtualItems,
    measureElement: (_rowId: string, element: HTMLElement | null) => {
      virtualizer.measureElement(element as HTMLDivElement | null)
    },
    scrollToIndex: virtualizer.scrollToIndex,
    scrollToOffset: virtualizer.scrollToOffset,
  }
}
