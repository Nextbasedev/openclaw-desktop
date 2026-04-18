"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscClose } from "react-icons/vsc"
import { ActivityTab } from "./ActivityTab"
import { WorkspaceTab } from "./WorkspaceTab"
import { GitTab } from "./GitTab"

/* ── Tab definitions ── */

type TabId = "activity" | "workspace" | "git"

interface Tab {
  id: TabId
  label: string
}

const TABS: Tab[] = [
  { id: "activity", label: "Activity" },
  { id: "workspace", label: "Workspace" },
  { id: "git", label: "Git" },
]

/* ── Props ── */

interface InspectorPanelProps {
  open: boolean
  onClose: () => void
}

/* ── Panel ── */

export function InspectorPanel({ open, onClose }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("activity")

  return (
    <div
      className={cn(
        /* Slide transition — CSS only, no framer-motion */
        "flex flex-col shrink-0 overflow-hidden",
        "border-l border-border/50 bg-card",
        "transition-[width] duration-300 ease-in-out",
        open ? "w-[380px]" : "w-0",
      )}
      aria-hidden={!open}
    >
      {/* Inner wrapper keeps content at 380px so it doesn't reflow during animation */}
      <div className="flex h-full w-[380px] flex-col overflow-hidden">
        {/* ── Tab bar ── */}
        <div className="flex h-9 shrink-0 items-center border-b border-border/50 bg-card">
          <div className="flex flex-1 items-center">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex h-full items-center px-3.5 text-[12px] font-medium transition-colors",
                  activeTab === tab.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {/* Active underline */}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-foreground/60" />
                )}
              </button>
            ))}
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className={cn(
              "mr-1.5 flex size-6 items-center justify-center rounded",
              "text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors",
            )}
          >
            <VscClose className="size-3.5" />
          </button>
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "activity" && <ActivityTab />}
          {activeTab === "workspace" && <WorkspaceTab />}
          {activeTab === "git" && <GitTab />}
        </div>
      </div>
    </div>
  )
}
