"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { LuFileText, LuBrain } from "react-icons/lu"
import { MemoryDocuments } from "./MemoryDocuments"
import { MemoryRecall } from "./MemoryRecall"

type MemoryView = "documents" | "recall"

const TABS: Array<{ id: MemoryView; label: string; icon: React.ElementType }> = [
  { id: "documents", label: "Documents", icon: LuFileText },
  { id: "recall", label: "Recall", icon: LuBrain },
]

export function MemoryTab() {
  const [activeTab, setActiveTab] = useState<MemoryView>("documents")

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Memory</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Agent workspace files and recalled context chunks.
        </p>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-secondary/30 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2",
                "text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === "documents" && <MemoryDocuments />}
      {activeTab === "recall" && <MemoryRecall />}
    </div>
  )
}
