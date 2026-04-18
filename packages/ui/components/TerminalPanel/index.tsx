"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { VscClose, VscAdd, VscChevronDown, VscChevronUp } from "react-icons/vsc"

const MIN_HEIGHT = 120
const MAX_HEIGHT = 600
const DEFAULT_HEIGHT = 280

type TerminalTab = {
  id: string
  title: string
}

type TerminalPanelProps = {
  open: boolean
  onToggle: () => void
  externalHeight?: number | null
  onExternalHeightUsed?: () => void
  instantOpen?: boolean
}

let tabCounter = 1

export function TerminalPanel({ open, onToggle, externalHeight, onExternalHeightUsed, instantOpen = false }: TerminalPanelProps) {
  const [tabs, setTabs] = React.useState<TerminalTab[]>([
    { id: "term-1", title: "Terminal 1" },
  ])
  const [activeTabId, setActiveTabId] = React.useState("term-1")
  const [height, setHeight] = React.useState(DEFAULT_HEIGHT)
  const [isDragging, setIsDragging] = React.useState(false)
  const dragRef = React.useRef<{ startY: number; startHeight: number } | null>(null)
  const skipNextOpenAnimationRef = React.useRef(false)

  // Accept height from footer drag-to-open
  React.useEffect(() => {
    if (externalHeight != null && externalHeight > 0) {
      skipNextOpenAnimationRef.current = instantOpen
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, externalHeight)))
      onExternalHeightUsed?.()
    }
  }, [externalHeight, onExternalHeightUsed, instantOpen])

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startY: e.clientY, startHeight: height }
      setIsDragging(true)
    },
    [height],
  )

  React.useEffect(() => {
    if (open && skipNextOpenAnimationRef.current) {
      const id = window.requestAnimationFrame(() => {
        skipNextOpenAnimationRef.current = false
      })
      return () => window.cancelAnimationFrame(id)
    }
  }, [open])

  React.useEffect(() => {
    if (!isDragging) return

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      // Dragging top edge — moving up = taller, moving down = shorter
      const delta = dragRef.current.startY - e.clientY
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta))
      setHeight(newHeight)
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

  const addTab = React.useCallback(() => {
    tabCounter++
    const newTab: TerminalTab = {
      id: `term-${tabCounter}`,
      title: `Terminal ${tabCounter}`,
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [])

  const closeTab = React.useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          onToggle()
          return [{ id: "term-1", title: "Terminal 1" }]
        }
        if (activeTabId === id) {
          const closedIndex = prev.findIndex((t) => t.id === id)
          const newActive =
            next[Math.min(closedIndex, next.length - 1)]
          setActiveTabId(newActive.id)
        }
        return next
      })
    },
    [activeTabId, onToggle]
  )

  return (
    <div
      className={cn(
        "relative flex flex-col border-t border-border/50 bg-card",
        !isDragging && !skipNextOpenAnimationRef.current && "transition-all duration-300 ease-in-out",
        open
          ? "opacity-100"
          : "h-0 opacity-0 overflow-hidden"
      )}
      style={{ height: open ? height : 0 }}
    >
      {/* Drag handle — top edge (invisible) */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize"
      />

      {/* Terminal header with tabs */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/40 bg-card">
        {/* Tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "group flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border/30 px-3 text-xs transition-colors",
                activeTabId === tab.id
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
              )}
            >
              <span className="truncate">{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }
                }}
                className={cn(
                  "flex size-4 cursor-pointer items-center justify-center rounded transition-colors",
                  "text-muted-foreground/50 hover:bg-secondary hover:text-foreground",
                  activeTabId === tab.id
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                )}
              >
                <VscClose className="size-3" />
              </span>
            </button>
          ))}

          {/* Add tab button */}
          <button
            type="button"
            onClick={addTab}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            aria-label="New terminal"
          >
            <VscAdd className="size-3.5" />
          </button>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-1 px-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Toggle terminal"
          >
            {open ? (
              <VscChevronDown className="size-3.5" />
            ) : (
              <VscChevronUp className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close terminal"
          >
            <VscClose className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 flex flex-col p-3 font-mono text-sm",
              activeTabId === tab.id ? "block" : "hidden"
            )}
          >
            <div className="flex-1 overflow-y-auto text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="text-green-400">➜</span>
                <span className="text-blue-400">~/openclaw-desktop</span>
                <span className="animate-pulse text-foreground">▊</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Prevent text selection while dragging */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}
    </div>
  )
}
