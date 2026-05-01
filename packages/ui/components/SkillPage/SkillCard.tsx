"use client"

import { cn } from "@/lib/utils"
import {
  LuDownload,
  LuArrowRight,
  LuCheck,
} from "react-icons/lu"
import type { DiscoveredSkill } from "./types"

export function SkillCard({
  skill,
  installing,
  onInstall,
  onToggle,
  onClick,
}: {
  skill: DiscoveredSkill
  installing: boolean
  onInstall: (slug: string) => void
  onToggle: (slug: string) => void
  onClick: (slug: string) => void
}) {
  return (
    <div
      className={cn(
        "group relative flex min-h-[168px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/5",
        "bg-white/[0.03] p-5 backdrop-blur-2xl transition-all duration-300",
        "hover:bg-white/[0.08] hover:border-white/10 hover:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)]",
        skill.installed && !skill.enabled && "opacity-60 grayscale-[0.5]",
      )}
      onClick={() => onClick(skill.slug)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(skill.slug)
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex flex-1 items-start gap-4 min-w-0">
          <div className="min-w-0 flex-1 pt-0.5 pl-1">
            <h3 className="truncate text-[15px] font-semibold text-foreground/90 group-hover:text-foreground transition-colors">
              {skill.name}
            </h3>
            <p className="mt-1.5 min-h-[2.75rem] line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/80 group-hover:text-muted-foreground transition-colors">
              {skill.description || "No description available."}
            </p>
          </div>
        </div>

        <div
          className="relative z-10 flex shrink-0 items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {skill.installed ? (
            <button
              type="button"
              onClick={() => onToggle(skill.slug)}
              className="group/toggle flex h-6 w-10 cursor-pointer items-center rounded-full bg-white/5 p-1 ring-1 ring-white/10 transition-all hover:bg-white/10"
              aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
            >
              <div
                className={cn(
                  "h-4 w-4 rounded-full transition-all duration-300 shadow-sm",
                  skill.enabled
                    ? "translate-x-4 bg-white shadow-white"
                    : "translate-x-0 bg-zinc-500",
                )}
              />
            </button>
          ) : installing ? (
            <div className="flex size-8 items-center justify-center">
              <div className="size-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onInstall(skill.slug)}
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-full shadow-sm",
                "bg-white/5 text-muted-foreground ring-1 ring-white/10 transition-all duration-300",
                "hover:scale-110 hover:bg-primary hover:text-primary-foreground hover:ring-primary/20",
              )}
              aria-label={`Install ${skill.name}`}
            >
              <LuDownload size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="relative mt-auto pt-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            skill.source === "clawhub"
              ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20"
              : skill.source === "local"
                ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20"
                : "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
          )}>
             {skill.source}
          </div>

          {skill.installed && (
            <div className="flex items-center gap-1 rounded-full bg-blue-500/10 text-blue-400 px-2 py-0.5 text-[10px] font-bold ring-1 ring-blue-500/20">
              <LuCheck size={10} />
              <span>{skill.enabled ? "ENABLED" : "DISABLED"}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-tight text-muted-foreground/40 transition-all duration-300 group-hover:translate-x-1 group-hover:text-primary">
          <span className="uppercase opacity-0 group-hover:opacity-100 transition-opacity">Details</span>
          <LuArrowRight size={14} className="opacity-40 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  )
}
