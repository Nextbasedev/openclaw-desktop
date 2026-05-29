"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { RefObject } from "react"

export type VirtualRow = {
  index: number
  key: string
  start: number
  size: number
}

type CalculateVirtualRowsParams = {
  count: number
  scrollTop: number
  viewportHeight: number
  overscan: number
  getKey: (index: number) => string
  getSize: (index: number) => number
  extraIndexes?: number[]
}

export function calculateVirtualRows({
  count,
  scrollTop,
  viewportHeight,
  overscan,
  getKey,
  getSize,
  extraIndexes = [],
}: CalculateVirtualRowsParams): {
  rows: VirtualRow[]
  totalSize: number
  startIndex: number
  endIndex: number
} {
  if (count <= 0) return { rows: [], totalSize: 0, startIndex: 0, endIndex: 0 }

  const starts: number[] = new Array(count)
  const sizes: number[] = new Array(count)
  let totalSize = 0
  let firstVisible = 0
  let lastVisible = count - 1
  let foundFirst = false
  const viewportEnd = scrollTop + viewportHeight

  for (let i = 0; i < count; i++) {
    const size = Math.max(1, getSize(i))
    starts[i] = totalSize
    sizes[i] = size
    const itemEnd = totalSize + size
    if (!foundFirst && itemEnd >= scrollTop) {
      firstVisible = i
      foundFirst = true
    }
    if (totalSize <= viewportEnd) {
      lastVisible = i
    }
    totalSize = itemEnd
  }

  const startIndex = Math.max(0, firstVisible - overscan)
  const endIndex = Math.min(count, lastVisible + overscan + 1)
  const rowIndexes = new Set<number>()
  for (let i = startIndex; i < endIndex; i++) rowIndexes.add(i)
  for (const index of extraIndexes) {
    if (index >= 0 && index < count) rowIndexes.add(index)
  }

  const rows: VirtualRow[] = []
  for (const i of Array.from(rowIndexes).sort((a, b) => a - b)) {
    rows.push({ index: i, key: getKey(i), start: starts[i], size: sizes[i] })
  }
  return { rows, totalSize, startIndex, endIndex }
}

type UseVirtualChatRowsParams = {
  count: number
  enabled: boolean
  scrollContainerRef: RefObject<HTMLElement | null>
  getItemKey: (index: number) => string
  estimateSize: (index: number) => number
  overscan?: number
  extraIndexes?: number[]
}

export function useVirtualChatRows({
  count,
  enabled,
  scrollContainerRef,
  getItemKey,
  estimateSize,
  overscan = 8,
  extraIndexes = [],
}: UseVirtualChatRowsParams) {
  const [measuredSizes, setMeasuredSizes] = useState<Map<string, number>>(
    () => new Map()
  )
  const observedNodesRef = useRef(new Map<string, HTMLElement>())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 })

  const updateViewport = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setViewport((prev) => {
      const next = { scrollTop: el.scrollTop, height: el.clientHeight || 640 }
      if (
        Math.abs(prev.scrollTop - next.scrollTop) < 1 &&
        Math.abs(prev.height - next.height) < 1
      )
        return prev
      return next
    })
  }, [scrollContainerRef])

  useLayoutEffect(() => {
    updateViewport()
  }, [count, enabled, updateViewport])

  useEffect(() => {
    if (!enabled) return
    const el = scrollContainerRef.current
    if (!el) return
    updateViewport()
    el.addEventListener("scroll", updateViewport, { passive: true })
    window.addEventListener("resize", updateViewport)
    return () => {
      el.removeEventListener("scroll", updateViewport)
      window.removeEventListener("resize", updateViewport)
    }
  }, [enabled, scrollContainerRef, updateViewport])

  useEffect(() => {
    if (!enabled) return
    const observer = new ResizeObserver((entries) => {
      setMeasuredSizes((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.virtualRowKey
          if (!key) continue
          const nextSize = Math.ceil(entry.contentRect.height)
          const previous = next.get(key)
          if (nextSize > 0 && Math.abs((previous ?? 0) - nextSize) > 1) {
            next.set(key, nextSize)
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
    resizeObserverRef.current = observer
    observedNodesRef.current.forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      resizeObserverRef.current = null
    }
  }, [enabled])

  const measuredGetSize = useCallback(
    (index: number) =>
      measuredSizes.get(getItemKey(index)) ?? estimateSize(index),
    [estimateSize, getItemKey, measuredSizes]
  )

  const virtualState = useMemo(() => {
    if (!enabled) {
      return {
        rows: Array.from({ length: count }, (_, index) => ({
          index,
          key: getItemKey(index),
          start: 0,
          size: measuredGetSize(index),
        })),
        totalSize: 0,
        startIndex: 0,
        endIndex: count,
      }
    }
    return calculateVirtualRows({
      count,
      scrollTop: viewport.scrollTop,
      viewportHeight: viewport.height,
      overscan,
      getKey: getItemKey,
      getSize: measuredGetSize,
      extraIndexes,
    })
  }, [
    count,
    enabled,
    extraIndexes,
    getItemKey,
    measuredGetSize,
    overscan,
    viewport.height,
    viewport.scrollTop,
  ])

  const measureElement = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      const key = getItemKey(index)
      const previous = observedNodesRef.current.get(key)
      if (previous && previous !== node) {
        resizeObserverRef.current?.unobserve(previous)
        observedNodesRef.current.delete(key)
      }
      if (!node) return
      node.dataset.virtualRowKey = key
      observedNodesRef.current.set(key, node)
      resizeObserverRef.current?.observe(node)
      const nextSize = Math.ceil(node.getBoundingClientRect().height)
      if (nextSize > 0) {
        setMeasuredSizes((prev) => {
          const previousSize = prev.get(key)
          if (Math.abs((previousSize ?? 0) - nextSize) <= 1) return prev
          const next = new Map(prev)
          next.set(key, nextSize)
          return next
        })
      }
    },
    [getItemKey]
  )

  const scrollToIndex = useCallback(
    (index: number, align: "start" | "center" | "end" = "center") => {
      const el = scrollContainerRef.current
      if (!el || index < 0 || index >= count) return false
      let start = 0
      for (let i = 0; i < index; i++) start += measuredGetSize(i)
      const size = measuredGetSize(index)
      const target =
        align === "start"
          ? start
          : align === "end"
            ? start + size - el.clientHeight
            : start + size / 2 - el.clientHeight / 2
      el.scrollTo({ top: Math.max(0, target), behavior: "smooth" })
      return true
    },
    [count, measuredGetSize, scrollContainerRef]
  )

  return {
    enabled,
    rows: virtualState.rows,
    totalSize: virtualState.totalSize,
    startIndex: virtualState.startIndex,
    endIndex: virtualState.endIndex,
    measureElement,
    scrollToIndex,
  }
}
