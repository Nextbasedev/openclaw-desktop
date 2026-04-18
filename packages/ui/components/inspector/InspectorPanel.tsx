"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscChromeClose } from "react-icons/vsc"
import { ActivityTab } from "./ActivityTab"
import { WorkspaceTab } from "./WorkspaceTab"
import { GitTab } from "./GitTab"

type TabId = "activity" | "workspace" | "git"

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  { id: "activity", label: "Activity", description: "See what's happening" },
  { id: "workspace", label: "Workspace", description: "Open files and tree" },
  { id: "git", label: "Git", description: "Changes and history" },
]

interface InspectorPanelProps {
  open: boolean
  onClose: () => void
}

export function InspectorPanel({ open, onClose }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("activity")
  const activeMeta = TABS.find((tab) => tab.id === activeTab)

  return (
    <aside
      className={cn(
        "shrink-0 overflow-hidden border-l border-border/50 bg-card/95",
        "transition-[width,opacity] duration-300 ease-in-out",
        open ? "w-[390px] opacity-100" : "w-0 opacity-0",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full w-[390px] flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]">
        <div className="border-b border-border/50 px-4 pb-3 pt-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/80">
                Inspector
              </p>
              <h2 className="mt-1 text-[15px] font-semibold text-foreground">
                {activeMeta?.label}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {activeMeta?.description}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
            >
              <VscChromeClose className="size-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-border/50 bg-background/40 p-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "rounded-[10px] px-3 py-2 text-left transition-all",
                    isActive
                      ? "bg-secondary text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                  )}
                >
                  <div className="text-[12px] font-medium leading-none">{tab.label}</div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground/90">
                    {tab.description}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-background/20">
          {activeTab === "activity" && <ActivityTab />}
          {activeTab === "workspace" && <WorkspaceTab />}
          {activeTab === "git" && <GitTab />}
        </div>
      </div>
    </aside>
  )
}
