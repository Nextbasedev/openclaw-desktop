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
  const updatedAt = Date.parse(space.updatedAt)
  if (!Number.isNaN(updatedAt)) return updatedAt

  const createdAt = Date.parse(space.createdAt)
  if (!Number.isNaN(createdAt)) return createdAt

  return 0
}

export function CollapsedSpacesPopover({
  spaces,
  activeSpaceId,
  onSpaceSwitch,
  onSpaceCreate,
}: Props) {
  const [open, setOpen] = useState(false)
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? null
  const activeSpaceLabel = activeSpace?.name ?? "MySpace"
  const orderedSpaces = useMemo(() => {
    const inactiveSpaces = [...spaces]
      .filter((space) => space.id !== activeSpaceId)
      .sort((a, b) => getSpaceRank(b) - getSpaceRank(a))

    return activeSpace ? [activeSpace, ...inactiveSpaces] : inactiveSpaces
  }, [activeSpace, activeSpaceId, spaces])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <GlassTooltip label={activeSpaceLabel} disabled={open}>
            <button
              type="button"
              className={cn(
                "group flex size-8 cursor-pointer items-center justify-center rounded-full",
                "text-foreground/85 transition-[background-color,color,opacity] duration-150 ease-in-out hover:bg-white/[0.08] hover:text-foreground",
              )}
              aria-label="Spaces"
            >
              <span className="relative flex size-4 items-center justify-center">
                {activeSpace ? (
                  <span
                    className={cn(
                      "size-3.5 rounded-full bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_0_16px_rgba(0,0,0,0.16)]",
                      gradientForSpace(activeSpace),
                    )}
                  />
                ) : (
                  <Icons.Project size={16} strokeWidth={1.5} />
                )}
              </span>
            </button>
          </GlassTooltip>
        </div>
      </PopoverTrigger>

      <PopoverContent
        align="center"
        side="top"
        sideOffset={10}
        collisionPadding={12}
        className={cn("w-[248px] p-2", GLASS_POPOVER)}
      >
        <div className="flex items-center justify-between px-2.5 pb-2 pt-1">
          <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-foreground">
            {activeSpaceLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void onSpaceCreate()
            }}
            className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
            title="New space"
          >
            <LuPlus className="size-3.5 stroke-[1.9]" />
          </button>
        </div>

        <div className="max-h-[220px] overflow-y-auto px-1 pb-1">
          {orderedSpaces.map((space) => (
            <button
              key={space.id}
              type="button"
              onClick={() => {
                setOpen(false)
                void onSpaceSwitch(space.id)
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                space.id === activeSpace?.id
                  ? "bg-white/[0.06] text-foreground"
                  : "text-foreground/85 hover:bg-white/[0.08] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
                  gradientForSpace(space),
                )}
              />
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
