"use client"

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { LuPlus } from "react-icons/lu"
import { cn } from "@/lib/utils"
import type { Space } from "@/types/space"
import { MenuAction } from "./ProjectsSection/MenuAction"
import { CreateSpaceDialog } from "./CreateSpaceDialog"
import { GlassTooltip } from "./SidebarItem"
import { SpaceContextMenuPortal } from "./SpaceContextMenuPortal"
import { SpaceDialogs } from "./SpaceDialogs"
import { SpaceIconImage, spaceIconSrc } from "./SpaceIconImage"

type Props = {
  spaces: Space[]
  activeSpaceId: string | null
  tooltipsDisabled?: boolean
  onCollapsedPreviewStart?: (spaceId: string) => void
  onSpaceSwitch: (spaceId: string) => void | Promise<void>
  onSpaceNewChat: (spaceId: string) => void | Promise<void>
  onSpaceCreate: (name?: string, iconImage?: SpaceIconImage | null) => void | Promise<void>
  onSpaceUpdate: (spaceId: string, input: { name?: string; repoRoot?: string | null }) => unknown | Promise<unknown>
  onSpaceArchive: (spaceId: string) => void | Promise<void>
  onSpaceDelete: (spaceId: string) => void | Promise<void>
}

type SpaceIconImage = NonNullable<Space["iconImage"]>

const SPACE_ICON_GRADIENTS = [
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.10)_0%,rgba(15,36,46,0.82)_42%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(35,25,55,0.82)_44%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(19,45,38,0.80)_44%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(56,37,20,0.82)_44%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.10)_0%,rgba(22,40,58,0.82)_42%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(48,26,42,0.78)_44%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(18,42,56,0.82)_44%,#09090B_100%)]",
  "bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(50,43,24,0.76)_44%,#09090B_100%)]",
]
const NEW_SPACE_ICON_SURFACE = "bg-[linear-gradient(135deg,#09090B_0%,rgba(23,22,25,0.85)_50%,rgba(25,23,25,0.65)_100%)]"

function gradientForSpace(space: Space) {
  const seed = [...space.id].reduce((total, char) => total + char.charCodeAt(0), 0)
  return SPACE_ICON_GRADIENTS[seed % SPACE_ICON_GRADIENTS.length]
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

type PlusMenuState = {
  open: boolean
  x: number
  y: number
}

const CONTEXT_MENU_WIDTH = 184
const CONTEXT_MENU_HEIGHT = 144
const VIEWPORT_MARGIN = 12

export function CollapsedSpacesPopover({
  spaces,
  activeSpaceId,
  tooltipsDisabled = false,
  onCollapsedPreviewStart,
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
  const [iconImage, setIconImage] = useState<SpaceIconImage | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, space: null })
  const [plusMenu, setPlusMenu] = useState<PlusMenuState>({ open: false, x: 0, y: 0 })
  const orderedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => getSpaceRank(a) - getSpaceRank(b))
  }, [spaces])

  useEffect(() => {
    if (createOpen || renameOpen) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [createOpen, renameOpen])

  useEffect(() => {
    if (!contextMenu.open && !plusMenu.open) return
    function closeOnPointerDown(event: PointerEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      if (plusMenuRef.current?.contains(event.target as Node)) return
      setContextMenu((prev) => ({ ...prev, open: false, space: null }))
      setPlusMenu((prev) => ({ ...prev, open: false }))
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu((prev) => ({ ...prev, open: false, space: null }))
        setPlusMenu((prev) => ({ ...prev, open: false }))
      }
    }
    window.addEventListener("pointerdown", closeOnPointerDown)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [contextMenu.open, plusMenu.open])

  function openProject(space: Space) {
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    void onSpaceSwitch(space.id)
  }

  function openCreate() {
    setPlusMenu((prev) => ({ ...prev, open: false }))
    setName("New Project")
    setIconImage(null)
    setIconError(null)
    setCreateOpen(true)
  }

  async function submitCreate() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onSpaceCreate(name.trim(), iconImage)
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
    setPlusMenu((prev) => ({ ...prev, open: false }))
  }

  function openPlusMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    const x = Math.min(Math.max(event.clientX, VIEWPORT_MARGIN), window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN)
    const y = Math.min(Math.max(event.clientY, VIEWPORT_MARGIN), window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_MARGIN)
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    setPlusMenu({ open: true, x, y })
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

        return (
          <GlassTooltip key={space.id} label={space.name} disabled={tooltipsDisabled || contextMenu.open}>
            <button
              type="button"
              onClick={() => openProject(space)}
              onMouseEnter={() => onCollapsedPreviewStart?.(space.id)}
              onContextMenu={(event) => openContextMenu(event, space)}
              className={cn(
                "group flex size-10 cursor-pointer items-center justify-center rounded-md border transition-all duration-150 ease-in-out",
                active
                  ? "border-white shadow-[0_12px_26px_rgba(0,0,0,0.34)]"
                  : "border-transparent shadow-[0_12px_26px_rgba(0,0,0,0.34)] hover:border-white/20",
              )}
              aria-label={`Open project ${space.name}`}
            >
              <span
                className={cn(
                  "relative flex size-full items-center justify-center overflow-hidden rounded-md bg-transparent text-[14px] font-semibold text-white/80 shadow-lg shadow-black/30 ring-1 ring-white/[0.06] backdrop-blur-sm",
                  !spaceIconSrc(space) && gradientForSpace(space),
                  active && "text-white brightness-125 saturate-125 ring-white/20",
                )}
              >
                {spaceIconSrc(space) ? <SpaceIconImage space={space} /> : spaceInitial(space)}
              </span>
            </button>
          </GlassTooltip>
        )
      })}

      <GlassTooltip label="New project" disabled={createOpen || contextMenu.open}>
        <button
          type="button"
          onClick={openCreate}
          onContextMenu={openPlusMenu}
          className={cn(
            "flex size-10 cursor-pointer items-center justify-center rounded-md text-white/70 shadow-[0_12px_26px_rgba(0,0,0,0.34)] transition-all hover:text-white hover:brightness-110 hover:shadow-[0_12px_26px_rgba(0,0,0,0.34)]",
            NEW_SPACE_ICON_SURFACE,
          )}
          aria-label="New project"
        >
          <LuPlus className="size-5.5 stroke-[1.7]" />
        </button>
      </GlassTooltip>

      <CreateSpaceDialog
        open={createOpen}
        busy={busy}
        name={name}
        iconImage={iconImage}
        iconError={iconError}
        inputRef={inputRef}
        onOpenChange={setCreateOpen}
        onNameChange={setName}
        onIconImageChange={setIconImage}
        onIconErrorChange={setIconError}
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

      {typeof document !== "undefined" && plusMenu.open && createPortal(
        <div
          ref={plusMenuRef}
          style={{
            position: "fixed",
            left: plusMenu.x,
            top: plusMenu.y,
            transformOrigin: "top left",
          }}
          className={cn(
            "z-[120] w-44 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1.5",
            "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
            "backdrop-blur-[40px] backdrop-saturate-[180%]",
          )}
        >
          <MenuAction
            label="New Space"
            icon={<LuPlus size={14} strokeWidth={1.7} />}
            onClick={openCreate}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
