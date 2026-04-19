"use client"

import * as React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import { cn } from "@/lib/utils"
import { VscClose, VscAdd } from "react-icons/vsc"
import { ActivityTab } from "./ActivityTab"
import { WorkspaceTab } from "./WorkspaceTab"
import { GitTab } from "./GitTab"
import { XTerminal } from "@/components/terminal/XTerminal"

type TabId = "activity" | "workspace" | "git" | "terminal"

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "git", label: "Git" },
  { id: "workspace", label: "Workspace" },
  { id: "activity", label: "Activity" },
  { id: "terminal", label: "Terminal" },
]

function getResponsiveDefaults() {
  if (typeof window === "undefined") return { min: 400, max: 700, default: 500 }
  const vw = window.innerWidth
  if (vw < 768) return { min: 240, max: Math.min(vw * 0.7, 360), default: Math.min(vw * 0.6, 300) }
  if (vw < 1024) return { min: 260, max: 380, default: 300 }
  if (vw < 1440) return { min: 320, max: 500, default: 380 }
  return { min: 400, max: 700, default: 500 }
}

type TerminalTab = {
  id: string
  title: string
}

interface InspectorPanelProps {
  open: boolean
  onClose: () => void
  terminalActive?: boolean
  onTerminalActiveChange?: (active: boolean) => void
}

export function InspectorPanel({ open, onClose, terminalActive, onTerminalActiveChange }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("activity")
  const responsiveRef = useRef(getResponsiveDefaults())
  const [width, setWidth] = useState(responsiveRef.current.default)
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

  const tabCounterRef = useRef(1)
  const [termTabs, setTermTabs] = useState<TerminalTab[]>([
    { id: "term-1", title: "Terminal 1" },
  ])
  const [activeTermId, setActiveTermId] = useState("term-1")
  const termScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (terminalActive && open) {
      setActiveTab("terminal")
    }
  }, [terminalActive, open])

  useEffect(() => {
    if (onTerminalActiveChange) {
      onTerminalActiveChange(activeTab === "terminal")
    }
  }, [activeTab, onTerminalActiveChange])

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

  const addTermTab = useCallback(() => {
    tabCounterRef.current++
    const newTab: TerminalTab = {
      id: `term-${tabCounterRef.current}`,
      title: `Terminal ${tabCounterRef.current}`,
    }
    setTermTabs((prev) => [...prev, newTab])
    setActiveTermId(newTab.id)
  }, [])

  const closeTermTab = useCallback(
    (id: string) => {
      setTermTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          tabCounterRef.current = 1
          return [{ id: "term-1", title: "Terminal 1" }]
        }
        if (activeTermId === id) {
          const closedIndex = prev.findIndex((t) => t.id === id)
          const newActive = next[Math.min(closedIndex, next.length - 1)]
          setActiveTermId(newActive.id)
        }
        return next
      })
    },
    [activeTermId],
  )

  return (
    <aside
      className={cn(
        "shrink-0 overflow-clip border-l border-border/50 bg-card",
        !isDragging && "transition-[width,opacity] duration-300 ease-in-out",
        open ? "opacity-100" : "w-0 opacity-0",
        "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:border-l max-md:shadow-xl",
        "md:relative",
      )}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      {/* Drag handle — left edge */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize"
      />

      <div className="flex h-full min-w-0 flex-col" style={{ width, maxWidth: width }}>
        {/* Main tabs */}
        <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex h-full cursor-pointer items-center px-2.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-foreground/70" />
                )}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-clip">
          {activeTab === "activity" && <ActivityTab />}
          {activeTab === "workspace" && <WorkspaceTab />}
          {activeTab === "git" && <GitTab />}
          {activeTab === "terminal" && (
            <div className="flex h-full flex-col overflow-hidden">
              {/* Terminal session tabs */}
              <div
                ref={termScrollRef}
                onWheel={(e) => {
                  if (termScrollRef.current) {
                    e.preventDefault()
                    termScrollRef.current.scrollLeft += e.deltaY
                  }
                }}
                className="block h-7 w-full shrink-0 overflow-x-auto overflow-y-hidden border-b border-border/30 bg-card"
                style={{ scrollbarWidth: "none" } as React.CSSProperties}
              >
                <div className="inline-flex h-7 items-center whitespace-nowrap">
                  {termTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTermId(tab.id)}
                      className={cn(
                        "group flex h-7 cursor-pointer items-center gap-1 border-r border-border/20 px-2.5 text-[11px] whitespace-nowrap transition-colors",
                        activeTermId === tab.id
                          ? "bg-background text-foreground"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                      )}
                    >
                      <span>{tab.title}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTermTab(tab.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation()
                            closeTermTab(tab.id)
                          }
                        }}
                        className={cn(
                          "flex size-3.5 cursor-pointer items-center justify-center rounded transition-colors",
                          "text-muted-foreground/40 hover:bg-secondary hover:text-foreground",
                          activeTermId === tab.id
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        <VscClose className="size-2.5" />
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={addTermTab}
                    className="flex size-7 cursor-pointer items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground"
                    aria-label="New terminal"
                  >
                    <VscAdd className="size-3" />
                  </button>
                </div>
              </div>

              {/* Terminal body */}
              <div className="relative flex-1 overflow-hidden bg-white dark:bg-black">
                {termTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="absolute inset-0"
                    style={{
                      visibility: activeTermId === tab.id ? "visible" : "hidden",
                      zIndex: activeTermId === tab.id ? 1 : 0,
                    }}
                  >
                    <XTerminal visible={activeTermId === tab.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prevent text selection while dragging */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </aside>
  )
}
