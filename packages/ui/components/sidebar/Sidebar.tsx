"use client"

import { useMemo, useState } from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { SidebarItem, type SidebarNavItem } from "./SidebarItem"
import { VersionUpdateButton } from "./VersionUpdateButton"
import { VersionUpdateModal } from "./VersionUpdateModal"

const DEFAULT_ITEMS: SidebarNavItem[] = [
  { id: "chat", label: "Chat", icon: "chat", accent: "emerald" },
  { id: "skill", label: "Skill", icon: "skill", accent: "violet" },
  { id: "usage", label: "Usage", icon: "usage", accent: "sky" },
  { id: "workspace", label: "Workspace", icon: "workspace", accent: "amber" },
  { id: "memory", label: "Memory", icon: "memory", accent: "rose" },
]

type SidebarProps = {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [items, setItems] = useState<SidebarNavItem[]>(DEFAULT_ITEMS)
  const [activeTab, setActiveTab] = useState<string>("chat")
  const [versionModalOpen, setVersionModalOpen] = useState(false)

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeTab),
    [items, activeTab],
  )

  function moveItem(index: number, direction: "up" | "down") {
    setItems((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev

      const next = [...prev]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }

  return (
    <>
      <aside
        className={cn(
          "relative flex h-full w-[290px] shrink-0 flex-col overflow-hidden",
          "border-r border-white/8 bg-[linear-gradient(180deg,rgba(18,20,27,0.96)_0%,rgba(13,15,22,0.98)_100%)] text-white",
          "shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(67,97,238,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.10),transparent_28%)]" />

        <div className="relative flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
              Workspace
            </p>
            <h2 className="mt-1 text-sm font-semibold text-white/95">
              OpenClaw Desktop
            </h2>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 p-1 shadow-inner shadow-black/10 backdrop-blur-sm">
            <span className="rounded-lg bg-white/10 p-1 text-white/80">
              <Icons.SidebarLeft size={14} strokeWidth={1.8} />
            </span>
            <span className="rounded-lg p-1 text-white/40">
              <Icons.SidebarRight size={14} strokeWidth={1.8} />
            </span>
          </div>
        </div>

        <div className="relative border-b border-white/8 px-4 py-3">
          <div className="rounded-2xl border border-white/8 bg-white/6 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
                  Active Space
                </p>
                <p className="mt-1 text-sm font-medium text-white/90">
                  {activeItem?.label ?? "Project"}
                </p>
              </div>
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                Live
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-white/45">
              Native-style panel layout with focused navigation and production-ready desktop spacing.
            </p>
          </div>
        </div>

        <nav className="relative flex-1 overflow-y-auto px-3 py-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Modules
            </p>
            <p className="text-[10px] text-white/25">Reorder stack</p>
          </div>

          <div className="flex flex-col gap-2.5">
            {items.map((item, index) => (
              <SidebarItem
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                isActive={activeTab === item.id}
                onClick={() => setActiveTab(item.id)}
                onMoveUp={() => moveItem(index, "up")}
                onMoveDown={() => moveItem(index, "down")}
              />
            ))}
          </div>

          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
              Pinned
            </p>

            <button
              type="button"
              onClick={() => setActiveTab("project")}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all duration-200",
                activeTab === "project"
                  ? "border-white/14 bg-white/10 shadow-[0_14px_30px_rgba(0,0,0,0.24)]"
                  : "border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.06]",
              )}
            >
              <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-white/80">
                <Icons.Files size={18} strokeWidth={1.7} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white/90">Project</p>
                <p className="truncate text-xs text-white/40">
                  Pinned root destination
                </p>
              </div>
            </button>
          </div>
        </nav>

        <div className="relative border-t border-white/8 px-3 py-3">
          <VersionUpdateButton onClick={() => setVersionModalOpen(true)} />
        </div>
      </aside>

      <VersionUpdateModal
        open={versionModalOpen}
        onOpenChange={setVersionModalOpen}
      />
    </>
  )
}
