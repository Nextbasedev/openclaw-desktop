"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { LuBox, LuCheck, LuChevronDown, LuEllipsis, LuFolderGit2, LuPlus, LuPencil, LuTrash2 } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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

type DialogMode = "create" | "rename" | "repo" | "delete" | null

export function SpacesSection({ spaces, activeSpaceId, onSwitch, onCreate, onUpdate, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DialogMode>(null)
  const [target, setTarget] = useState<Space | null>(null)
  const [name, setName] = useState("")
  const [repoRoot, setRepoRoot] = useState("")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null

  useEffect(() => {
    if (mode) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [mode])

  function openCreate() {
    setTarget(null)
    setName("New Space")
    setRepoRoot("")
    setMode("create")
  }

  function openRename(space: Space) {
    setTarget(space)
    setName(space.name)
    setMode("rename")
  }

  function openRepo(space: Space) {
    setTarget(space)
    setRepoRoot(space.repoRoot ?? "")
    setMode("repo")
  }

  async function submitDialog() {
    if (busy) return
    setBusy(true)
    try {
      if (mode === "create") await onCreate(name)
      if (mode === "rename" && target) await onUpdate(target.id, { name })
      if (mode === "repo" && target) await onUpdate(target.id, { repoRoot: repoRoot.trim() || null })
      if (mode === "delete" && target) await onDelete(target.id)
      setMode(null)
      setTarget(null)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative z-10 border-t border-white/[0.06] px-2 pb-2.5 pt-2 dark:border-white/[0.06]">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "group relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-2xl px-2.5 py-2.5 text-left",
              "border border-white/[0.09] bg-[linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025))] shadow-[0_18px_42px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl",
              "transition-all duration-200 hover:border-white/[0.16] hover:bg-[linear-gradient(135deg,rgba(255,255,255,0.105),rgba(255,255,255,0.04))] hover:shadow-[0_20px_48px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.1)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15",
            )}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),rgba(255,255,255,0.055))] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
              <LuBox className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/55">Current Space</span>
              <span className="block truncate text-[13px] font-semibold leading-4 text-foreground">{activeSpace?.name ?? "Spaces"}</span>
              <span className="block truncate text-[11px] leading-4 text-muted-foreground/60">{activeSpace?.repoRoot || "Project workspace"}</span>
            </span>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground/55 transition-colors group-hover:bg-white/[0.06] group-hover:text-foreground/75">
              <LuChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={10}
          className={cn(
            "w-[304px] overflow-hidden rounded-2xl p-0 shadow-[0_28px_80px_-42px_rgba(0,0,0,0.95)]",
            GLASS_POPOVER,
          )}
        >
          <div className="border-b border-white/[0.07] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/65">Spaces</p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground/50">Separate chats by project</p>
              </div>
              <button
                onClick={openCreate}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.055] text-muted-foreground transition-all hover:border-white/[0.16] hover:bg-white/[0.1] hover:text-foreground"
                title="New Space"
              >
                <LuPlus className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex max-h-[292px] flex-col gap-1 overflow-y-auto p-2">
            {spaces.map((space) => {
              const isActive = activeSpaceId === space.id
              return (
                <div
                  key={space.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl border px-2 py-2 transition-all duration-150",
                    isActive
                      ? "border-white/[0.12] bg-white/[0.095] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                      : "border-transparent hover:border-white/[0.07] hover:bg-white/[0.055]",
                  )}
                >
                  <button className="min-w-0 flex flex-1 cursor-pointer items-center gap-2.5 text-left" onClick={() => { void onSwitch(space.id); setOpen(false) }}>
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-xl border transition-colors",
                        isActive
                          ? "border-white/[0.14] bg-white/[0.12] text-foreground"
                          : "border-white/[0.07] bg-white/[0.04] text-muted-foreground/70 group-hover:text-foreground/80",
                      )}
                    >
                      <LuBox className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground/92">{space.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground/50">{space.repoRoot || "No repo linked"}</span>
                    </span>
                    {isActive && (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
                        <LuCheck className="size-3" />
                      </span>
                    )}
                  </button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground/0 transition-all group-hover:text-muted-foreground/60 hover:bg-white/[0.08] hover:text-foreground">
                        <LuEllipsis className="size-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" side="right" sideOffset={6} className={cn("w-40 rounded-xl p-1", GLASS_POPOVER)}>
                      <MenuButton icon={<LuPencil />} label="Rename" onClick={() => openRename(space)} />
                      <MenuButton icon={<LuFolderGit2 />} label="Link repo" onClick={() => openRepo(space)} />
                      <MenuButton icon={<LuTrash2 />} label="Delete" danger disabled={spaces.length <= 1} onClick={() => { setTarget(space); setMode("delete") }} />
                    </PopoverContent>
                  </Popover>
                </div>
              )
            })}
          </div>
          {spaces.length === 0 && (
            <div className="px-3 pb-3 text-[12px] text-muted-foreground/55">Create your first Space to separate chats by project.</div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={mode !== null} onOpenChange={(next) => !next && setMode(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "New Space" : mode === "rename" ? "Rename Space" : mode === "repo" ? "Link repository" : "Delete Space"}</DialogTitle>
            <DialogDescription>
              {mode === "delete" ? "Chats in this Space will be archived so they do not appear in other Spaces." : "Spaces keep chats and project context separated while using the same base agent."}
            </DialogDescription>
          </DialogHeader>
          {(mode === "create" || mode === "rename") && (
            <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submitDialog()} className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          )}
          {mode === "repo" && (
            <input ref={inputRef} value={repoRoot} onChange={(e) => setRepoRoot(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submitDialog()} placeholder="/path/to/repo" className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
            <Button variant={mode === "delete" ? "destructive" : "default"} onClick={() => void submitDialog()} disabled={busy || ((mode === "create" || mode === "rename") && !name.trim())}>
              {mode === "delete" ? "Delete Space" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MenuButton({ icon, label, onClick, danger, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "text-red-400 hover:bg-red-500/10" : "text-foreground/80 hover:bg-white/10 hover:text-foreground",
      )}
    >
      <span className="[&_svg]:size-3.5">{icon}</span>
      {label}
    </button>
  )
}
