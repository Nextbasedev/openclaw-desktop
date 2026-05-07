"use client"

import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

type TooltipState = {
  title: string
  x: number
  y: number
  maxWidth: number
}

type UseHoverTitleTooltipOptions = {
  title: string
  nativeTitle?: string
  className?: string
  offsetY?: number
  maxWidth?: number
}

export function useHoverTitleTooltip({
  title,
  nativeTitle,
  className,
  offsetY = 10,
  maxWidth = 520,
}: UseHoverTitleTooltipOptions) {
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null)

  const show = React.useCallback((event: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    if (!title.trim() || typeof window === "undefined") return

    const rect = event.currentTarget.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const resolvedMaxWidth = Math.min(maxWidth, Math.max(220, viewportWidth - 24))
    const pointerX = "clientX" in event && event.clientX ? event.clientX - 10 : rect.left
    const x = Math.min(
      Math.max(12, pointerX),
      Math.max(12, viewportWidth - resolvedMaxWidth - 12),
    )

    setTooltip({
      title,
      x,
      y: rect.bottom + offsetY,
      maxWidth: resolvedMaxWidth,
    })
  }, [maxWidth, offsetY, title])

  const hide = React.useCallback(() => setTooltip(null), [])

  const triggerProps = React.useMemo(() => ({
    title: nativeTitle ?? title,
    "aria-label": nativeTitle ?? title,
    onPointerEnter: show,
    onPointerMove: show,
    onPointerLeave: hide,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  }), [hide, nativeTitle, show, title])

  const TooltipPortal = React.useCallback(() => {
    if (!tooltip || typeof document === "undefined") return null

    return createPortal(
      <div
        role="tooltip"
        style={{
          left: tooltip.x,
          top: tooltip.y,
          maxWidth: tooltip.maxWidth,
        }}
        className={cn(
          "pointer-events-none fixed z-[99999] min-h-[26px] rounded-[12px] border border-white/18 bg-zinc-950/80 px-3 py-1.5 text-[12px] font-medium leading-[17px] text-white shadow-2xl shadow-black/35 backdrop-blur-2xl",
          className,
        )}
      >
        <span className="block whitespace-normal break-words px-px py-px">
          {tooltip.title}
        </span>
      </div>,
      document.body,
    )
  }, [className, tooltip])

  return { triggerProps, TooltipPortal, hideTooltip: hide }
}
