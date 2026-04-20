"use client"

import { cn } from "@/lib/utils"
import { LuDownload } from "react-icons/lu"
import type { DiscoveredSkill } from "./types"

function SkillIcon({ slug }: { slug: string }) {
  const letter = (slug[0] ?? "S").toUpperCase()
  const hue = slug.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div
      className="flex size-10 items-center justify-center rounded-lg text-[15px] font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue}, 50%, 40%)` }}
    >
      {letter}
    </div>
  )
}

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
        "group flex min-h-[160px] cursor-pointer flex-col rounded-2xl border",
        "bg-white/[0.04] p-5 backdrop-blur-xl",
        "transition-all duration-200",
        " hover:bg-white/[0.07] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
        skill.installed && !skill.enabled && "opacity-50",
      )}
      onClick={() => onClick(skill.slug)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(skill.slug)
      }}
    >
      <div className="flex items-start gap-3.5">
        <SkillIcon slug={skill.slug} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-normal text-foreground">
              {skill.name}
            </p>
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {skill.description || "No description available."}
          </p>
        </div>

        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {skill.installed ? (
            <button
              type="button"
              onClick={() => onToggle(skill.slug)}
              className="cursor-pointer"
              aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
            >
              <div
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  skill.enabled
                    ? "bg-green-500"
                    : "bg-muted-foreground/30",
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-white shadow-sm",
                    "transition-transform",
                    skill.enabled
                      ? "translate-x-4"
                      : "translate-x-0.5",
                  )}
                />
              </div>
            </button>
          ) : installing ? (
            <div className="flex size-8 items-center justify-center">
              <div className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onInstall(skill.slug)}
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-full",
                "bg-white/[0.06] text-muted-foreground transition-colors",
                "hover:bg-white/[0.12] hover:text-foreground",
              )}
              aria-label={`Install ${skill.name}`}
            >
              <LuDownload size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 pl-[54px] ">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            skill.source === "clawhub"
              ? "bg-blue-500/10 text-blue-400"
              : skill.source === "local"
                ? "bg-green-500/10 text-green-400"
                : "bg-zinc-500/10 text-zinc-400",
          )}
        >
          {skill.source}
        </span>
        {skill.installed && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            installed
          </span>
        )}
      </div>
    </div>
  )
}
