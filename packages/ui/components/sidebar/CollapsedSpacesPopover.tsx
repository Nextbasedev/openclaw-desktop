"use client"

import { useMemo, useState } from "react"
import { LuPlus } from "react-icons/lu"
import { Icons } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { cn } from "@/lib/utils"
import type { Space } from "@/types/space"
import { GlassTooltip } from "./SidebarItem"

type Props = {
  spaces: Space[]
  activeSpaceId: string | null
  onSpaceSwitch: (spaceId: string) => void | Promise<void>
  onSpaceNewChat: (spaceId: string) => void | Promise<void>
  onSpaceCreate: (name?: string) => void | Promise<void>
}

const DOT_GRADIENTS = [
  "from-cyan-300 via-sky-400 to-violet-500",
  "from-violet-300 via-fuchsia-400 to-pink-500",
  "from-emerald-300 via-teal-400 to-cyan-500",
  "from-amber-200 via-orange-400 to-rose-500",
  "from-rose-300 via-pink-400 to-fuchsia-500",
]

function gradientForIndex(index: number) {
  return DOT_GRADIENTS[index % DOT_GRADIENTS.length]
}

function gradientForSpace(space: Space) {
  const seed = [...space.id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return gradientForIndex(seed)
}

function getSpaceRank(space: Space) {
  if (typeof space.sortOrder === "number") return space.sortOrder

  const createdAt = Date.parse(space.createdAt)
  if (!Number.isNaN(createdAt)) return createdAt

  return 0
}

function spaceInitial(space: Space | null) {
  return (space?.name?.trim()?.[0] || "P").toUpperCase()
}

function displayRepoRoot(space: Space | null) {
  if (!space?.repoRoot) return "No repository linked"
  const separator = space.repoRoot.includes("\\") ? "\\" : "/"
  const parts = space.repoRoot.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return space.repoRoot
  return `${parts.at(-2)}${separator}${parts.at(-1)}`
}

export function CollapsedSpacesPopover({
  spaces,
  activeSpaceId,
  onSpaceSwitch,
  onSpaceNewChat,
  onSpaceCreate,
}: Props) {
  const [open, setOpen] = useState(false)
  const [previewSpaceId, setPreviewSpaceId] = useState<string | null>(null)
  const orderedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => getSpaceRank(a) - getSpaceRank(b))
  }, [spaces])
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? null
  const previewSpace = spaces.find((space) => space.id === previewSpaceId) ?? activeSpace ?? orderedSpaces[0] ?? null
  const previewLabel = previewSpace?.name ?? "Projects"

  function openProject(space: Space) {
    setPreviewSpaceId(space.id)
    setOpen(true)
    void onSpaceSwitch(space.id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="flex flex-col items-center gap-3" aria-label="Projects">
          {orderedSpaces.map((space) => {
            const active = space.id === activeSpaceId

            return (
              <GlassTooltip key={space.id} label={space.name} disabled={open}>
                <button
                  type="button"
                  onClick={() => openProject(space)}
                  className={cn(
                    "group flex size-10 cursor-pointer items-center justify-center rounded-xl border",
                    "bg-white/[0.045] text-foreground/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all duration-150 ease-in-out hover:bg-white/[0.08] hover:text-foreground",
                    active
                      ? "border-violet-400/70 shadow-[0_0_0_1px_rgba(168,85,247,0.35),0_0_20px_rgba(168,85,247,0.24)]"
                      : "border-white/[0.12]",
                  )}
                  aria-label={`Open project ${space.name}`}
                >
                  <span className="relative flex size-7 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#3b255f] via-[#31204b] to-[#17131f] text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                    {spaceInitial(space)}
                  </span>
                </button>
              </GlassTooltip>
            )
          })}

          <GlassTooltip label="New project" disabled={open}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                void onSpaceCreate()
              }}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-white/[0.08] text-muted-foreground/70 transition-all hover:bg-white/[0.08] hover:text-foreground"
              aria-label="New project"
            >
              <LuPlus className="size-5 stroke-[1.7]" />
            </button>
          </GlassTooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="right"
        sideOffset={10}
        collisionPadding={12}
        className={cn("w-[252px] p-2", GLASS_POPOVER)}
      >
        <div className="flex items-start justify-between gap-3 px-2.5 pb-2 pt-1">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {previewLabel}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {displayRepoRoot(previewSpace)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void onSpaceCreate()
            }}
            className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
            title="New project"
          >
            <LuPlus className="size-3.5 stroke-[1.9]" />
          </button>
        </div>

        {previewSpace && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void onSpaceNewChat(previewSpace.id)
            }}
            className="mb-2 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.035] text-[13px] font-semibold text-foreground transition-colors hover:bg-white/[0.07]"
          >
            <Icons.Edit size={15} strokeWidth={1.7} />
            New session
          </button>
        )}

        <div className="max-h-[220px] overflow-y-auto px-1 pb-1">
          {orderedSpaces.map((space) => (
            <button
              key={space.id}
              type="button"
              onClick={() => openProject(space)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                space.id === previewSpace?.id
                  ? "bg-white/[0.06] text-foreground"
                  : "text-foreground/85 hover:bg-white/[0.08] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-[9px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
                  gradientForSpace(space),
                )}
              >
                {spaceInitial(space)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {space.name}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
