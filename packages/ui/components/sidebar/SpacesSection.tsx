"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { LuBox, LuChevronDown, LuEllipsis, LuFolderGit2, LuPlus, LuPencil, LuTrash2 } from "react-icons/lu"
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
    <div className="relative z-10 border-t border-border/15 px-2 py-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-border/35 bg-secondary/30 px-2.5 py-2 text-left transition-colors hover:bg-secondary/55"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
              <LuBox className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{activeSpace?.name ?? "Spaces"}</span>
              <span className="block truncate text-[11px] text-muted-foreground/60">{activeSpace?.repoRoot || "Project workspace"}</span>
            </span>
            <LuChevronDown className="size-3.5 text-muted-foreground/55" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={8} className={cn("w-[286px] p-2", GLASS_POPOVER)}>
          <div className="mb-2 flex items-center justify-between px-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/65">Spaces</p>
              <p className="text-[11px] text-muted-foreground/45">Separate chats by project</p>
            </div>
            <button onClick={openCreate} className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground" title="New Space">
              <LuPlus className="size-4" />
            </button>
          </div>
          <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
            {spaces.map((space) => (
              <div key={space.id} className={cn("group flex items-center gap-2 rounded-xl px-2 py-2", activeSpaceId === space.id ? "bg-foreground text-background" : "hover:bg-white/8")}>
                <button className="min-w-0 flex flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => { void onSwitch(space.id); setOpen(false) }}>
                  <span className={cn("size-2 shrink-0 rounded-full", activeSpaceId === space.id ? "bg-background" : "bg-muted-foreground/40")} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{space.name}</span>
                    {space.repoRoot && <span className={cn("block truncate text-[11px]", activeSpaceId === space.id ? "text-background/60" : "text-muted-foreground/50")}>{space.repoRoot}</span>}
                  </span>
                </button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={cn("flex size-6 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100", activeSpaceId === space.id ? "hover:bg-background/15" : "hover:bg-white/10")}>
                      <LuEllipsis className="size-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="right" sideOffset={6} className={cn("w-40 p-1", GLASS_POPOVER)}>
                    <MenuButton icon={<LuPencil />} label="Rename" onClick={() => openRename(space)} />
                    <MenuButton icon={<LuFolderGit2 />} label="Link repo" onClick={() => openRepo(space)} />
                    <MenuButton icon={<LuTrash2 />} label="Delete" danger disabled={spaces.length <= 1} onClick={() => { setTarget(space); setMode("delete") }} />
                  </PopoverContent>
                </Popover>
              </div>
            ))}
          </div>
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
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "text-red-400 hover:bg-red-500/10" : "text-foreground/80 hover:bg-white/10 hover:text-foreground",
      )}
    >
      <span className="[&_svg]:size-3.5">{icon}</span>
      {label}
    </button>
  )
}
