"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ActivityTab } from "./ActivityTab"
import { WorkspaceTab } from "./WorkspaceTab"
import { GitTab } from "./GitTab"

type TabId = "activity" | "workspace" | "git"

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "workspace", label: "Workspace" },
  { id: "git", label: "Git" },
]

const MIN_WIDTH = 300
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 390

interface InspectorPanelProps {
  open: boolean
  onClose: () => void
}

export function InspectorPanel({ open, onClose }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("activity")
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

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
      // Dragging left edge → moving left = wider, moving right = narrower
      const delta = dragRef.current.startX - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta))
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
      className={cn(
        "relative shrink-0 overflow-hidden border-l border-border/50 bg-card",
        !isDragging && "transition-[width,opacity] duration-300 ease-in-out",
        open ? "opacity-100" : "w-0 opacity-0",
      )}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      {/* Drag handle — left edge */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize",
          "hover:bg-foreground/10",
          isDragging && "bg-foreground/15",
        )}
      />

      <div className="flex h-full flex-col" style={{ width }}>
        {/* Tabs */}
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
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === "activity" && <ActivityTab />}
          {activeTab === "workspace" && <WorkspaceTab />}
          {activeTab === "git" && <GitTab />}
        </div>
      </div>

      {/* Prevent text selection while dragging */}
      {isDragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </aside>
  )
}
