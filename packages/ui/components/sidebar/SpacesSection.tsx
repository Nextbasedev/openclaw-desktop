"use client"

import { useEffect, useRef, useState } from "react"
import { LuBox, LuPlus } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

export function SpacesSection({ spaces, activeSpaceId, onSwitch, onCreate }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("New Space")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null

  useEffect(() => {
    if (createOpen) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [createOpen])

  function openCreate() {
    setName("New Space")
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
        aria-label="Spaces"
      >
        <div className="flex min-w-0 items-center gap-4">
          {activeSpace && (
            <button
              type="button"
              onClick={() => void onSwitch(activeSpace.id)}
              title={activeSpace.name}
              aria-label={`Current space: ${activeSpace.name}`}
              className="relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            >
              <span className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-300 via-sky-400 to-violet-500 shadow-[0_0_14px_rgba(56,189,248,0.55)]" />
              <LuBox className="relative size-2.5 text-white/90" />
              <span className="absolute -right-0.5 -top-0.5 flex size-2.5 items-center justify-center rounded-full bg-zinc-950/85 ring-1 ring-white/20">
                <LuPlus className="size-1.5 text-white/80" />
              </span>
            </button>
          )}

          {spaces.filter((space) => space.id !== activeSpace?.id).slice(0, 4).map((space, index) => (
            <button
              key={space.id}
              type="button"
              onClick={() => void onSwitch(space.id)}
              title={space.name}
              aria-label={`Switch to ${space.name}`}
              className="group flex size-3 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full bg-gradient-to-br opacity-45 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-all duration-150 group-hover:size-2.5 group-hover:opacity-90",
                  DOT_GRADIENTS[(index + 1) % DOT_GRADIENTS.length],
                )}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={openCreate}
          title="New Space"
          aria-label="New Space"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/70 transition-all hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <LuPlus className="size-5 stroke-[1.7]" />
        </button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>New Space</DialogTitle>
            <DialogDescription>
              Create a workspace to keep chats and project context separated.
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
              Create Space
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
