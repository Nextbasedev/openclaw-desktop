"use client"

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { LuPlus } from "react-icons/lu"
import { cn } from "@/lib/utils"
import type { Space } from "@/types/space"
import { MenuAction } from "./ProjectsSection/MenuAction"
import { CreateSpaceDialog } from "./CreateSpaceDialog"
import { GlassTooltip } from "./SidebarItem"
import { SpaceContextMenuPortal } from "./SpaceContextMenuPortal"
import { SpaceDialogs } from "./SpaceDialogs"
import { SpaceIconImage, spaceIconEmoji, spaceIconEmojiColor, spaceIconSrc } from "./SpaceIconImage"

type Props = {
  spaces: Space[]
  activeSpaceId: string | null
  tooltipsDisabled?: boolean
  onCollapsedPreviewStart?: (spaceId: string) => void
  onSpaceSwitch: (spaceId: string) => void | Promise<void>
  onSpaceNewChat: (spaceId: string) => void | Promise<void>
  onSpaceCreate: (name?: string, iconImage?: SpaceIconImage | null, iconEmoji?: SpaceIconEmoji | null) => void | Promise<void>
  onSpaceUpdate: (spaceId: string, input: { name?: string; iconEmoji?: SpaceIconEmoji | null; repoRoot?: string | null }) => unknown | Promise<unknown>
  onSpaceArchive: (spaceId: string) => void | Promise<void>
  onSpaceDelete: (spaceId: string) => void | Promise<void>
}

type SpaceIconImage = NonNullable<Space["iconImage"]>
type SpaceIconEmoji = NonNullable<Space["iconEmoji"]>

const SPACE_ICON_GRADIENTS = [
  "bg-[linear-gradient(135deg,#020618_0%,rgba(5,51,69,0.80)_50%,rgba(5,47,74,0.60)_100%)]",
  "bg-[linear-gradient(135deg,#080615_0%,rgba(38,28,68,0.78)_50%,rgba(18,38,72,0.58)_100%)]",
  "bg-[linear-gradient(135deg,#03100D_0%,rgba(12,58,50,0.76)_50%,rgba(6,45,60,0.58)_100%)]",
  "bg-[linear-gradient(135deg,#120A05_0%,rgba(68,42,18,0.76)_50%,rgba(56,28,38,0.56)_100%)]",
  "bg-[linear-gradient(135deg,#050B18_0%,rgba(14,48,88,0.78)_50%,rgba(30,28,76,0.58)_100%)]",
  "bg-[linear-gradient(135deg,#120614_0%,rgba(62,28,58,0.76)_50%,rgba(40,28,76,0.56)_100%)]",
  "bg-[linear-gradient(135deg,#020A12_0%,rgba(8,58,82,0.78)_50%,rgba(20,46,90,0.58)_100%)]",
  "bg-[linear-gradient(135deg,#111006_0%,rgba(62,55,22,0.72)_50%,rgba(40,48,46,0.54)_100%)]",
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
const PREVIEW_OPEN_DELAY_MS = 140

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
  const [iconEmoji, setIconEmoji] = useState<SpaceIconEmoji>({ emoji: "✨", label: "sparkles", color: "from-zinc-950 to-zinc-800" })
  const [iconError, setIconError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const previewTimerRef = useRef<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, space: null })
  const [plusMenu, setPlusMenu] = useState<PlusMenuState>({ open: false, x: 0, y: 0 })
  const [archivedSelected, setArchivedSelected] = useState(false)
  const orderedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => getSpaceRank(a) - getSpaceRank(b))
  }, [spaces])

  useEffect(() => {
    if (createOpen || renameOpen) window.setTimeout(() => inputRef.current?.focus(), 40)
  }, [createOpen, renameOpen])

  useEffect(() => {
    return () => {
      if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setArchivedSelected(false)
  }, [activeSpaceId])

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

  function clearPreviewTimer() {
    if (previewTimerRef.current === null) return
    window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = null
  }

  function schedulePreview(space: Space) {
    if (!onCollapsedPreviewStart) return
    clearPreviewTimer()
    previewTimerRef.current = window.setTimeout(() => {
      onCollapsedPreviewStart(space.id)
      previewTimerRef.current = null
    }, PREVIEW_OPEN_DELAY_MS)
  }

  function openProject(space: Space) {
    clearPreviewTimer()
    setArchivedSelected(false)
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    void onSpaceSwitch(space.id)
  }

  function openCreate() {
    setPlusMenu((prev) => ({ ...prev, open: false }))
    setName("New Project")
    setIconImage(null)
    setIconEmoji({ emoji: "✨", label: "sparkles", color: "from-zinc-950 to-zinc-800" })
    setIconError(null)
    setCreateOpen(true)
  }

  function openArchivedChats() {
    clearPreviewTimer()
    setArchivedSelected(true)
    setContextMenu((prev) => ({ ...prev, open: false, space: null }))
    setPlusMenu((prev) => ({ ...prev, open: false }))
    window.dispatchEvent(new CustomEvent("openclaw:show-archived-chats"))
  }

  async function submitCreate() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onSpaceCreate(name.trim(), iconImage, iconEmoji)
      setCreateOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function submitRename() {
    if (busy || !renameTarget || !name.trim()) return
    setBusy(true)
    try {
      await onSpaceUpdate(renameTarget.id, { name: name.trim(), iconEmoji })
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
    setIconEmoji(space.iconEmoji ?? { emoji: "✨", label: "sparkles", color: "from-zinc-950 to-zinc-800" })
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
    <div className="flex flex-col items-center gap-3" aria-label="Projects" onMouseLeave={clearPreviewTimer}>
      <GlassTooltip label="Archived chats" disabled={tooltipsDisabled || contextMenu.open}>
        <button
          type="button"
          onClick={openArchivedChats}
          className={cn(
            "group relative flex size-10 cursor-pointer items-center justify-center rounded-xl border text-white/80 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            archivedSelected
              ? "scale-[1.05] border-transparent bg-white/[0.075] shadow-[0_16px_34px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.14)]"
              : "border-transparent bg-[linear-gradient(135deg,#111827_0%,rgba(31,41,55,0.9)_50%,rgba(17,24,39,0.7)_100%)] shadow-[0_10px_24px_rgba(0,0,0,0.28)] hover:scale-[1.035] hover:bg-white/[0.035] hover:text-white hover:shadow-[0_14px_28px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)]",
          )}
          aria-label="Open archived chats"
        >
          {archivedSelected && (
            <motion.span
              layoutId="project-rail-active-indicator"
              className="absolute -right-[10px] top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_14px_rgba(255,255,255,0.38)]"
              transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
            />
          )}
          <span className="relative flex size-full items-center justify-center overflow-hidden rounded-[10px] after:pointer-events-none after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.18),transparent_36%)] after:opacity-65">
            <ArchiveBoxIcon />
          </span>
        </button>
      </GlassTooltip>

      {orderedSpaces.map((space) => {
        const active = !archivedSelected && space.id === activeSpaceId
        const hasCustomIcon = Boolean(spaceIconSrc(space))
        const emojiIcon = spaceIconEmoji(space)

        return (
          <GlassTooltip key={space.id} label={space.name} disabled={tooltipsDisabled || contextMenu.open}>
            <button
              type="button"
              onClick={() => openProject(space)}
              onMouseEnter={() => schedulePreview(space)}
              onMouseLeave={clearPreviewTimer}
              onContextMenu={(event) => openContextMenu(event, space)}
              className={cn(
                "group relative flex size-10 cursor-pointer items-center justify-center rounded-xl border transition-[background,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                active
                  ? "scale-[1.05] border-transparent bg-white/[0.075] shadow-[0_16px_34px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.14)]"
                  : "border-transparent shadow-[0_10px_24px_rgba(0,0,0,0.28)] hover:scale-[1.035] hover:bg-white/[0.035] hover:shadow-[0_14px_28px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)]",
              )}
              aria-label={`Open project ${space.name}`}
            >
              {active && (
                <motion.span
                  layoutId="project-rail-active-indicator"
                  className="absolute -right-[10px] top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_14px_rgba(255,255,255,0.38)]"
                  transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex size-full items-center justify-center overflow-hidden rounded-[10px] bg-transparent text-[14px] font-semibold text-white/80 shadow-lg shadow-black/25 backdrop-blur-sm transition-all duration-300",
                  "after:pointer-events-none after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.18),transparent_36%)] after:opacity-65",
                  emojiIcon && "bg-gradient-to-br text-[18px] leading-none",
                  emojiIcon && spaceIconEmojiColor(space),
                  !hasCustomIcon && !emojiIcon && gradientForSpace(space),
                  active
                    ? "text-white brightness-110 saturate-115 shadow-[0_10px_22px_rgba(0,0,0,0.24)]"
                    : "group-hover:text-white group-hover:brightness-106 group-hover:saturate-120",
                )}
              >
                {emojiIcon ? <span className="inline-flex -translate-y-px items-center justify-center leading-none">{emojiIcon}</span> : spaceIconSrc(space) ? <SpaceIconImage space={space} /> : spaceInitial(space)}
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
            "mt-1 flex size-10 cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/[0.14] text-white/55 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition-all duration-200 hover:scale-[1.04] hover:border-white/28 hover:text-white hover:brightness-110 hover:shadow-[0_14px_30px_rgba(0,0,0,0.36)]",
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
        iconEmoji={iconEmoji}
        iconError={iconError}
        inputRef={inputRef}
        onOpenChange={setCreateOpen}
        onNameChange={setName}
        onIconImageChange={setIconImage}
        onIconEmojiChange={setIconEmoji}
        onIconErrorChange={setIconError}
        onSubmit={submitCreate}
      />

      <SpaceDialogs
        busy={busy}
        name={name}
        iconEmoji={iconEmoji}
        inputRef={inputRef}
        renameOpen={renameOpen}
        deleteOpen={deleteOpen}
        deleteTarget={deleteTarget}
        onNameChange={setName}
        onIconEmojiChange={setIconEmoji}
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

function ArchiveBoxIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 5.25h10" />
      <path d="M4 5.25v6.25A1.5 1.5 0 0 0 5.5 13h5A1.5 1.5 0 0 0 12 11.5V5.25" />
      <path d="M4.75 3h6.5L12 5.25H4L4.75 3Z" />
      <path d="M8 7.25v3" />
      <path d="m6.75 9.25 1.25 1.25 1.25-1.25" />
    </svg>
  )
}
