"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"
import { LuPlus } from "react-icons/lu"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import type { Space } from "@/types/space"
import { SpaceDialogs } from "./SpaceDialogs"
import { SpacesOverflowMenu } from "./SpacesOverflowMenu"
import { SpaceContextMenuPortal } from "./SpaceContextMenuPortal"
import { CreateSpaceDialog } from "./CreateSpaceDialog"

type Props = {
  spaces: Space[]
  activeSpaceId: string | null
  onSwitch: (spaceId: string) => void | Promise<void>
  onNewChat: (spaceId: string) => void | Promise<void>
  onCreate: (name?: string) => void | Promise<void>
  onUpdate: (spaceId: string, input: { name?: string; repoRoot?: string | null }) => unknown | Promise<unknown>
  onArchive: (spaceId: string) => void | Promise<void>
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

type ContextMenuState = {
  open: boolean
  x: number
  y: number
  space: Space | null
}

const CONTEXT_MENU_WIDTH = 184
const CONTEXT_MENU_HEIGHT = 144
const VIEWPORT_MARGIN = 12

export function SpacesSection({
  spaces,
  activeSpaceId,
  onSwitch,
  onNewChat,
  onCreate,
  onUpdate,
  onArchive,
  onDelete,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [actionMenuSpaceId, setActionMenuSpaceId] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Space | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null)
  const [name, setName] = useState("New Project")
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, space: null })
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? null
  const displaySpaces = [...spaces].sort((a, b) => getSpaceRank(a) - getSpaceRank(b))
  const quickSpaces = displaySpaces.slice(0, 4)
  const overflowSpaces = displaySpaces.slice(4)

  useEffect(() => {
    if (createOpen) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [createOpen])

  useEffect(() => {
    if (!renameOpen) return
    window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [renameOpen])

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

  async function submitRename() {
    if (busy || !renameTarget || !name.trim()) return
    setBusy(true)
    try {
      await onUpdate(renameTarget.id, { name: name.trim() })
      setRenameOpen(false)
      setRenameTarget(null)
    } finally {
      setBusy(false)
    }
  }

  function handleSwitch(spaceId: string) { void onSwitch(spaceId) }

  function closeMenus() {
    setActionMenuSpaceId(null)
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
  }

  function openContextMenu(event: MouseEvent<HTMLElement>, space: Space) {
    event.preventDefault()
    event.stopPropagation()
    const x = Math.min(Math.max(event.clientX, VIEWPORT_MARGIN), window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN)
    const y = Math.min(Math.max(event.clientY, VIEWPORT_MARGIN), window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_MARGIN)
    setActionMenuSpaceId(null)
    setContextMenu({ open: true, x, y, space })
  }

  function beginRename(space: Space) {
    closeMenus()
    setRenameTarget(space)
    setName(space.name)
    setRenameOpen(true)
  }

  async function beginNewChat(space: Space) {
    closeMenus()
    await onNewChat(space.id)
  }

  async function beginArchive(space: Space) {
    closeMenus()
    await onArchive(space.id)
  }

  function beginDelete(space: Space) {
    closeMenus()
    setDeleteTarget(space)
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteTarget || busy) return
    setBusy(true)
    try {
      await onDelete(deleteTarget.id)
      setDeleteOpen(false)
      setDeleteTarget(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative z-10 border-t border-white/[0.06] px-3 pb-3 pt-2.5 dark:border-white/[0.06]">
      <div
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-md px-2.5",
          "border border-white/[0.07] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl",
        )}
        aria-label="Projects"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {quickSpaces.map((space) => (
              <Tooltip key={space.id} delayDuration={200}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleSwitch(space.id)}
                    onContextMenu={(event) => openContextMenu(event, space)}
                    aria-label={`Switch to project ${space.name}`}
                    className="group flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  >
                    <span
                      className={cn(
                        "rounded-full bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-all duration-200 ease-out",
                        space.id === activeSpace?.id
                          ? "size-3.5 opacity-100 shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_0_18px_rgba(103,232,249,0.42)]"
                          : "size-2 opacity-55 group-hover:size-2.75 group-hover:opacity-90",
                        gradientForSpace(space),
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} showArrow={false}>
                  {space.name}
                </TooltipContent>
              </Tooltip>
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
                  "w-52 gap-0 overflow-hidden rounded-md p-1.5",
                 )}
              >
                <SpacesOverflowMenu
                  spaces={overflowSpaces}
                  actionMenuSpaceId={actionMenuSpaceId}
                  gradientForSpace={gradientForSpace}
                  onSwitch={handleSwitch}
                  onContextMenu={openContextMenu}
                  onActionMenuChange={setActionMenuSpaceId}
                  onNewChat={beginNewChat}
                  onRename={beginRename}
                  onArchive={beginArchive}
                  onDelete={beginDelete}
                  onCloseOverflow={() => setOverflowOpen(false)}
                />
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
