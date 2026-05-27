"use client"

import * as React from "react"
import { useState, useRef, useCallback, useEffect, type CSSProperties } from "react"
import { cn } from "@/lib/utils"
import { InspectorView, type InspectorTabId } from "./InspectorView"
import type { InspectorScope } from "./inspectorScope"

function getResponsiveDefaults() {
  if (typeof window === "undefined") return { min: 480, max: 860, default: 480 }
  const vw = window.innerWidth
  if (vw < 768) return { min: 260, max: Math.min(vw * 0.82, 420), default: 260 }
  if (vw < 1024) return { min: 320, max: 520, default: 320 }
  if (vw < 1440) return { min: 420, max: 760, default: 420 }
  return { min: 460, max: 860, default: 460 }
}

interface InspectorPanelProps {
  open: boolean
  onClose: () => void
  onOpenFullWindow?: (tab: InspectorTabId) => void
  onWidthChange?: (width: number) => void
  terminalActive?: boolean
  onTerminalActiveChange?: (active: boolean) => void
  sessionKey?: string | null
  focusedToolCallId?: string | null
  onClearFocusedToolCall?: () => void
  projectId?: string | null
  activeAgentId?: string | null
  onAgentSelect?: (id: string) => void
  activeTab?: InspectorTabId
  onTabChange?: (tab: InspectorTabId) => void
  inspectorScope: InspectorScope
  onInspectorScopeChange: (scope: InspectorScope) => void
}

export function InspectorPanel({ open, onClose, onOpenFullWindow, onWidthChange, terminalActive, onTerminalActiveChange, sessionKey, focusedToolCallId, onClearFocusedToolCall, projectId, activeAgentId, onAgentSelect, activeTab: controlledActiveTab, onTabChange, inspectorScope, onInspectorScopeChange }: InspectorPanelProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<InspectorTabId>("activity")
  const responsiveDefaults = getResponsiveDefaults()
  const responsiveRef = useRef(responsiveDefaults)
  const [width, setWidth] = useState(responsiveDefaults.default)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    function onResize() {
      const r = getResponsiveDefaults()
      responsiveRef.current = r
      setWidth((prev) => Math.min(r.max, Math.max(r.min, prev)))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    onWidthChange?.(width)
  }, [onWidthChange, width])

  const panelStyle = {
    "--inspector-width": `${width}px`,
  } as CSSProperties

  const displayedTab =
    terminalActive
      ? "terminal"
      : focusedToolCallId
        ? "activity"
        : controlledActiveTab ?? internalActiveTab

  const handleTabChange = useCallback((tab: InspectorTabId) => {
    setInternalActiveTab(tab)
    onTabChange?.(tab)
  }, [onTabChange])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      setIsDragging(true)
    },
    [width],
  )

  useEffect(() => {
    if (!isDragging) return

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - e.clientX
      const r = responsiveRef.current
      const newWidth = Math.min(r.max, Math.max(r.min, dragRef.current.startWidth + delta))
      setWidth(newWidth)
    }

    function onMouseUp() {
      setIsDragging(false)
      dragRef.current = null
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isDragging])

  return (
    <aside
      style={panelStyle}
      className={cn(
        "shrink-0 overflow-clip border-l border-border/50 bg-card",
        !isDragging && "transition-[width,opacity,transform] duration-300 ease-out",
        open
          ? "w-[var(--inspector-width)] opacity-100 max-md:w-screen max-md:translate-x-0"
          : "w-0 opacity-0 max-md:pointer-events-none max-md:w-screen max-md:translate-x-full",
        "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:border-l max-md:shadow-xl",
        "md:relative",
      )}
      aria-hidden={!open}
    >
      {/* Drag handle — left edge */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize"
      />

      <div
        className="flex h-full min-w-0 flex-col w-[var(--inspector-width)] max-w-[var(--inspector-width)] max-md:w-screen max-md:max-w-screen"
      >
        <InspectorView
          activeTab={displayedTab}
          onTabChange={handleTabChange}
          onTerminalTabChange={onTerminalActiveChange}
          onClose={onClose}
          onOpenFullWindow={onOpenFullWindow}
          sessionKey={open ? sessionKey : null}
          focusedToolCallId={focusedToolCallId}
          onClearFocusedToolCall={onClearFocusedToolCall}
          projectId={projectId}
          inspectorScope={inspectorScope}
          onInspectorScopeChange={onInspectorScopeChange}
          activeAgentId={activeAgentId}
          onAgentSelect={onAgentSelect}
        />
      </div>

      {/* Prevent text selection while dragging */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </aside>
  )
}
