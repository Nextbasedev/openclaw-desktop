"use client"

import { useEffect, useRef, useState } from "react"
import { LuFolderKanban, LuPlus } from "react-icons/lu"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import type { Space } from "@/types/space"

type Props = {
  spaces: Space[]
  activeSpaceId: string | null
  onSwitch: (spaceId: string) => void | Promise<void>
  onCreate: (name?: string) => void | Promise<void>
  onUpdate: (spaceId: string, input: { name?: string; repoRoot?: string | null }) => unknown | Promise<unknown>
  onDelete: (spaceId: string) => void | Promise<void>
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

export function SpacesSection({ spaces, activeSpaceId, onSwitch, onCreate }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [name, setName] = useState("New Project")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null
  const quickSpaces = spaces.slice(0, 2)
  const overflowSpaces = spaces.slice(2)

  useEffect(() => {
    if (createOpen) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [createOpen])

  function openCreate() {
    setName("New Project")
    setCreateOpen(true)
  }

  async function submitCreate() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim())
      setCreateOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative z-10 border-t border-white/[0.06] px-3 pb-3 pt-2.5 dark:border-white/[0.06]">
      <div
        className={cn(
          "flex h-9 items-center justify-between gap-3 rounded-md px-2.5",
          "border border-white/[0.07] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl",
        )}
        aria-label="Projects"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {activeSpace && (
            <button
              type="button"
              onClick={() => void onSwitch(activeSpace.id)}
              title={activeSpace.name}
              aria-label={`Current project: ${activeSpace.name}`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center rounded-full">
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-300 via-sky-400 to-violet-500 shadow-[0_0_14px_rgba(56,189,248,0.55)]" />
                <LuFolderKanban className="relative size-2.5 text-white/90" />
              </span>
              <span className="min-w-0 truncate text-xs font-medium text-foreground/90">
                {activeSpace.name}
              </span>
            </button>
          )}

          <div className="flex shrink-0 items-center gap-1.5">
            {quickSpaces.map((space, index) => (
              <button
                key={space.id}
                type="button"
                onClick={() => void onSwitch(space.id)}
                title={space.name}
                aria-label={`Switch to project ${space.name}`}
                className="group flex size-3 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <span
                  className={cn(
                    "rounded-full bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-all duration-150",
                    space.id === activeSpace?.id
                      ? "size-2.5 opacity-100"
                      : "size-1.5 opacity-45 group-hover:size-2.5 group-hover:opacity-90",
                    gradientForIndex(index + 1),
                  )}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {overflowSpaces.length > 0 && (
            <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="More projects"
                  aria-label="More projects"
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/70 transition-all hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <Icons.MoreVertical size={15} strokeWidth={1.7} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="top"
                sideOffset={10}
                collisionPadding={12}
                className={cn(
                  GLASS_POPOVER,
                  "w-52 gap-0 overflow-hidden rounded-2xl p-1.5",
                  "border border-[var(--glass-border)] bg-[var(--glass-bg)]",
                  "backdrop-blur-[40px] backdrop-saturate-[180%]",
                  "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
                )}
              >
                <div className="mb-1 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/55">
                  More Projects
                </div>
                <div className="max-h-[50px] overflow-y-auto pr-1">
                  {overflowSpaces.map((space, index) => (
                    <button
                      key={space.id}
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false)
                        void onSwitch(space.id)
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    >
                      <span
                        className={cn(
                          "size-2.5 shrink-0 rounded-full bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
                          gradientForIndex(index + 3),
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
                        {space.name}
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <button
            type="button"
            onClick={openCreate}
            title="New Project"
            aria-label="New Project"
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/70 transition-all hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <LuPlus className="size-5 stroke-[1.7]" />
          </button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Create a project workspace to keep chats, repo context, and settings separated.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submitCreate()}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submitCreate()} disabled={busy || !name.trim()}>
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
