"use client"

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { LuPlus } from "react-icons/lu"
import { cn } from "@/lib/utils"
import type { Space } from "@/types/space"
import { CreateSpaceDialog } from "./CreateSpaceDialog"
import { GlassTooltip } from "./SidebarItem"
import { SpaceContextMenuPortal } from "./SpaceContextMenuPortal"
import { SpaceDialogs } from "./SpaceDialogs"

type Props = {
  spaces: Space[]
  activeSpaceId: string | null
  onSpaceSwitch: (spaceId: string) => void | Promise<void>
  onSpaceNewChat: (spaceId: string) => void | Promise<void>
  onSpaceCreate: (name?: string) => void | Promise<void>
  onSpaceUpdate: (spaceId: string, input: { name?: string; repoRoot?: string | null }) => unknown | Promise<unknown>
  onSpaceArchive: (spaceId: string) => void | Promise<void>
  onSpaceDelete: (spaceId: string) => void | Promise<void>
}

const ICON_STYLES = [
  {
    background: "from-slate-950 via-cyan-950/80 to-sky-950/60",
    text: "text-cyan-200",
    glow: "shadow-cyan-300/18",
  },
  {
    background: "from-zinc-950 via-violet-950/85 to-fuchsia-950/65",
    text: "text-violet-200",
    glow: "shadow-violet-300/18",
  },
  {
    background: "from-slate-950 via-emerald-950/80 to-teal-950/60",
    text: "text-emerald-200",
    glow: "shadow-emerald-300/18",
  },
  {
    background: "from-stone-950 via-amber-950/80 to-orange-950/60",
    text: "text-amber-200",
    glow: "shadow-amber-300/18",
  },
  {
    background: "from-zinc-950 via-rose-950/80 to-pink-950/60",
    text: "text-pink-200",
    glow: "shadow-pink-300/18",
  },
]

function styleForSpace(space: Space) {
  const seed = [...space.id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return ICON_STYLES[seed % ICON_STYLES.length]
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

type ContextMenuState = {
  open: boolean
  x: number
  y: number
  space: Space | null
}

const CONTEXT_MENU_WIDTH = 184
const CONTEXT_MENU_HEIGHT = 144
const VIEWPORT_MARGIN = 12

export function CollapsedSpacesPopover({
  spaces,
  activeSpaceId,
  onSpaceSwitch,
  onSpaceNewChat,
  onSpaceCreate,
  onSpaceUpdate,
  onSpaceArchive,
  onSpaceDelete,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Space | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null)
  const [name, setName] = useState("New Project")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, space: null })
  const orderedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => getSpaceRank(a) - getSpaceRank(b))
  }, [spaces])

  useEffect(() => {
    if (createOpen || renameOpen) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [createOpen, renameOpen])

  useEffect(() => {
    if (!contextMenu.open) return
    function closeOnPointerDown(event: PointerEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    }
    window.addEventListener("pointerdown", closeOnPointerDown)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [contextMenu.open])

  function openProject(space: Space) {
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    void onSpaceSwitch(space.id)
  }

  function openCreate() {
    setName("New Project")
    setCreateOpen(true)
  }

  async function submitCreate() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onSpaceCreate(name.trim())
      setCreateOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function submitRename() {
    if (busy || !renameTarget || !name.trim()) return
    setBusy(true)
    try {
      await onSpaceUpdate(renameTarget.id, { name: name.trim() })
      setRenameOpen(false)
      setRenameTarget(null)
    } finally {
      setBusy(false)
    }
  }

  function closeContextMenu() {
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
  }

  function openContextMenu(event: MouseEvent<HTMLElement>, space: Space) {
    event.preventDefault()
    event.stopPropagation()
    const x = Math.min(Math.max(event.clientX, VIEWPORT_MARGIN), window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN)
    const y = Math.min(Math.max(event.clientY, VIEWPORT_MARGIN), window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_MARGIN)
    setContextMenu({ open: true, x, y, space })
  }

  async function beginNewChat(space: Space) {
    closeContextMenu()
    await onSpaceNewChat(space.id)
  }

  function beginRename(space: Space) {
    closeContextMenu()
    setRenameTarget(space)
    setName(space.name)
    setRenameOpen(true)
  }

  async function beginArchive(space: Space) {
    closeContextMenu()
    await onSpaceArchive(space.id)
  }

  function beginDelete(space: Space) {
    closeContextMenu()
    setDeleteTarget(space)
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteTarget || busy) return
    setBusy(true)
    try {
      await onSpaceDelete(deleteTarget.id)
      setDeleteOpen(false)
      setDeleteTarget(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3" aria-label="Projects">
      {orderedSpaces.map((space) => {
        const active = space.id === activeSpaceId
        const iconStyle = styleForSpace(space)

        return (
          <GlassTooltip key={space.id} label={space.name} disabled={contextMenu.open}>
            <button
              type="button"
              onClick={() => openProject(space)}
              onContextMenu={(event) => openContextMenu(event, space)}
              className={cn(
                "group flex size-10 cursor-pointer items-center justify-center rounded-md border",
                "bg-white/[0.035] text-foreground/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all duration-150 ease-in-out hover:bg-white/[0.08] hover:text-foreground",
                active
                  ? "border-white shadow-[0_0_0_1px_rgba(255,255,255,0.75),0_0_18px_rgba(255,255,255,0.22)]"
                  : "border-0",
              )}
              aria-label={`Open project ${space.name}`}
            >
              <span
                className={cn(
                  "relative flex size-full items-center justify-center overflow-hidden rounded-md bg-gradient-to-br text-[14px] font-semibold shadow-lg shadow-black/25 ring-1 ring-inset ring-white/10",
                  iconStyle.background,
                  iconStyle.text,
                  iconStyle.glow,
                )}
              >
                {spaceInitial(space)}
              </span>
            </button>
          </GlassTooltip>
        )
      })}

      <GlassTooltip label="New project" disabled={createOpen || contextMenu.open}>
        <button
          type="button"
          onClick={openCreate}
          className="flex size-10 cursor-pointer items-center justify-center rounded-md border border-none bg-white/[0.035] text-muted-foreground/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:bg-white/[0.08] hover:text-foreground"
          aria-label="New project"
        >
          <LuPlus className="size-7 stroke-[1.7]" />
        </button>
      </GlassTooltip>

      <CreateSpaceDialog
        open={createOpen}
        busy={busy}
        name={name}
        inputRef={inputRef}
        onOpenChange={setCreateOpen}
        onNameChange={setName}
        onSubmit={submitCreate}
      />

      <SpaceDialogs
        busy={busy}
        name={name}
        inputRef={inputRef}
        renameOpen={renameOpen}
        deleteOpen={deleteOpen}
        deleteTarget={deleteTarget}
        onNameChange={setName}
        onRenameOpenChange={(open) => {
          setRenameOpen(open)
          if (!open) setRenameTarget(null)
        }}
        onDeleteOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) setDeleteTarget(null)
        }}
        onRenameSubmit={submitRename}
        onDeleteConfirm={confirmDelete}
      />

      {contextMenu.open && (
        <SpaceContextMenuPortal
          menuRef={contextMenuRef}
          space={contextMenu.space}
          x={contextMenu.x}
          y={contextMenu.y}
          onNewChat={beginNewChat}
          onRename={beginRename}
          onArchive={beginArchive}
          onDelete={beginDelete}
        />
      )}
    </div>
  )
}
