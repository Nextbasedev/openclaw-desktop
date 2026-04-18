"use client"

import { useState } from "react"
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

interface InspectorPanelProps {
  open: boolean
  onClose: () => void
}

export function InspectorPanel({ open, onClose }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("activity")

  return (
    <aside
      className={cn(
        "shrink-0 overflow-hidden border-l border-border/50 bg-card",
        "transition-[width,opacity] duration-300 ease-in-out",
        open ? "w-[390px] opacity-100" : "w-0 opacity-0",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full w-[390px] flex-col">
        {/* Tabs */}
        <div className="flex h-10 shrink-0 items-center border-b border-border/50 px-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex h-full items-center px-3 text-[12px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-foreground/70" />
                )}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1">
          {activeTab === "activity" && <ActivityTab />}
          {activeTab === "workspace" && <WorkspaceTab />}
          {activeTab === "git" && <GitTab />}
        </div>
      </div>
    </aside>
  )
}
