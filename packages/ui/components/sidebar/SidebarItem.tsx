"use client"

import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

export type SidebarNavItem = {
  id: string
  label: string
  icon: "chat" | "skill" | "usage" | "workspace" | "memory"
  accent?: string
}

type SidebarItemProps = {
  item: SidebarNavItem
  index: number
  total: number
  isActive: boolean
  onClick: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

const ACCENT_MAP: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  emerald: {
    border: "border-emerald-400/25",
    bg: "bg-emerald-400/10",
    text: "text-emerald-300",
    glow: "shadow-emerald-500/20",
  },
  violet: {
    border: "border-violet-400/25",
    bg: "bg-violet-400/10",
    text: "text-violet-300",
    glow: "shadow-violet-500/20",
  },
  sky: {
    border: "border-sky-400/25",
    bg: "bg-sky-400/10",
    text: "text-sky-300",
    glow: "shadow-sky-500/20",
  },
  amber: {
    border: "border-amber-400/25",
    bg: "bg-amber-400/10",
    text: "text-amber-300",
    glow: "shadow-amber-500/20",
  },
  rose: {
    border: "border-rose-400/25",
    bg: "bg-rose-400/10",
    text: "text-rose-300",
    glow: "shadow-rose-500/20",
  },
}

const SUBTITLE_MAP: Record<string, string> = {
  chat: "Conversations & prompts",
  skill: "Agent capabilities",
  usage: "Resource metrics",
  workspace: "Files & environment",
  memory: "Context & recall",
}

export function SidebarItem({
  item,
  index,
  total,
  isActive,
  onClick,
  onMoveUp,
  onMoveDown,
}: SidebarItemProps) {
  const accent = ACCENT_MAP[item.accent ?? "emerald"]

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-200",
        isActive
          ? cn("border-white/14 bg-white/10 shadow-[0_14px_30px_rgba(0,0,0,0.24)]", accent.glow)
          : "border-white/6 bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.05]",
      )}
    >
      {/* Icon */}
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl border transition-all duration-200",
          isActive
            ? cn(accent.border, accent.bg, accent.text)
            : "border-white/10 bg-white/8 text-white/60 group-hover:text-white/80",
        )}
      >
        <NavIcon type={item.icon} />
      </button>

      {/* Content */}
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 text-left"
      >
        <p
          className={cn(
            "text-sm font-medium transition-colors duration-200",
            isActive ? "text-white/95" : "text-white/75 group-hover:text-white/90",
          )}
        >
          {item.label}
        </p>
        <p className="truncate text-xs text-white/35">
          {SUBTITLE_MAP[item.icon]}
        </p>
      </button>

      {/* Reorder controls */}
      <div
        className={cn(
          "flex flex-col items-center gap-0.5 opacity-0 transition-opacity duration-200",
          "group-hover:opacity-100",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveUp()
          }}
          disabled={index === 0}
          className={cn(
            "flex size-5 items-center justify-center rounded-lg transition-colors",
            index === 0
              ? "cursor-not-allowed text-white/15"
              : "text-white/35 hover:bg-white/10 hover:text-white/60",
          )}
          aria-label="Move up"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8V2M2 4l3-2 3 2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveDown()
          }}
          disabled={index === total - 1}
          className={cn(
            "flex size-5 items-center justify-center rounded-lg transition-colors",
            index === total - 1
              ? "cursor-not-allowed text-white/15"
              : "text-white/35 hover:bg-white/10 hover:text-white/60",
          )}
          aria-label="Move down"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 2v6M2 6l3 2 3-2" />
          </svg>
        </button>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div
          className={cn(
            "absolute -left-px top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full",
            accent.bg,
          )}
        />
      )}
    </div>
  )
}

function NavIcon({ type }: { type: SidebarNavItem["icon"] }) {
  const iconMap: Record<string, React.ElementType> = {
    chat: Icons.Chat,
    skill: Icons.Tasks,
    usage: Icons.Dashboard,
    workspace: Icons.Home,
    memory: Icons.Memory,
  }

  const Icon = iconMap[type] || Icons.Chat

  return <Icon size={18} strokeWidth={1.7} />
}
