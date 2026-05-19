"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, Reorder } from "framer-motion"
import { Icons } from "@/components/icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { MenuAction } from "../ProjectsSection/MenuAction"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { formatCompactTime } from "@/utils/formatCompactTime"
import { chatDisplayName } from "@/utils/chatDisplayName"
import type { Chat } from "@/types/chat"
import { SidebarLabelTooltip } from "../SidebarLabelTooltip"

type Props = {
  chatId: string
  chat: Chat
  isActive: boolean
  isPinned: boolean
  isRunning?: boolean
  onClick: () => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  disableReorder?: boolean
}

type ContextMenuState = {
  open: boolean
  x: number
  y: number
}

const CHAT_MENU_OPEN_EVENT = "openclaw:sidebar-chat-menu-open"
const CONTEXT_MENU_WIDTH = 184
const CONTEXT_MENU_HEIGHT = 144
const VIEWPORT_MARGIN = 12
const MENU_SPRING = {
  type: "spring" as const,
  stiffness: 320,
  damping: 30,
  mass: 0.95,
}
export function ChatRow({
  chatId,
  chat,
  isActive,
  isPinned,
  isRunning = false,
  onClick,
  onPin,
  onRename,
  onArchive,
  onDelete,
  disableReorder,
}: Props) {
  const [dotMenuOpen, setDotMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  })
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const timeStr = chat.pendingFork ? "" : formatCompactTime(chat.updatedAt)
  const displayName = chatDisplayName(chat)
  const showRunningIndicator = isRunning && !chat.pendingFork
  const anyMenuOpen = dotMenuOpen || contextMenu.open

  useEffect(() => {
    function handleAnotherMenuOpened(event: Event) {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail
      if (detail?.chatId === chatId) return
      setDotMenuOpen(false)
      setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev))
    }

    window.addEventListener(CHAT_MENU_OPEN_EVENT, handleAnotherMenuOpened)
    return () =>
      window.removeEventListener(
        CHAT_MENU_OPEN_EVENT,
        handleAnotherMenuOpened,
      )
  }, [chatId])

  function announceMenuOpen() {
    window.dispatchEvent(
      new CustomEvent(CHAT_MENU_OPEN_EVENT, {
        detail: { chatId },
      }),
    )
  }

  useEffect(() => {
    if (!contextMenu.open) return

    function closeOnPointerDown(event: PointerEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu((prev) => ({ ...prev, open: false }))
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu((prev) => ({ ...prev, open: false }))
      }
    }

    window.addEventListener("pointerdown", closeOnPointerDown)
    window.addEventListener("keydown", closeOnEscape)

    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [contextMenu.open])

  function closeContextMenu() {
    setContextMenu((prev) => ({ ...prev, open: false }))
  }

  function openContextMenuAt(x: number, y: number) {
    const maxX = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN,
    )
    const maxY = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_MARGIN,
    )

    announceMenuOpen()
    setDotMenuOpen(false)
    setContextMenu({
      open: true,
      x: Math.min(Math.max(x, VIEWPORT_MARGIN), maxX),
      y: Math.min(Math.max(y, VIEWPORT_MARGIN), maxY),
    })
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (chat.pendingFork) return
    event.preventDefault()
    event.stopPropagation()
    openContextMenuAt(event.clientX, event.clientY)
  }

  function handleRenameAction() {
    setDotMenuOpen(false)
    closeContextMenu()
    onRename()
  }

  function handleArchiveAction() {
    setDotMenuOpen(false)
    closeContextMenu()
    onArchive()
  }

  function handleDeleteAction() {
    setDotMenuOpen(false)
    closeContextMenu()
    onDelete()
  }

  function handleDotMenuOpenChange(open: boolean) {
    setDotMenuOpen(open)
    if (open) {
      closeContextMenu()
      announceMenuOpen()
    }
  }

  const rowContent = (
    <>
      <SidebarLabelTooltip label={displayName} disabled={anyMenuOpen}>
        <button
          onClick={chat.pendingFork ? undefined : onClick}
          disabled={chat.pendingFork}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-1.5 pl-2 pr-7 text-left transition-colors duration-150",
            isActive
              ? "bg-foreground/7 text-foreground"
              : "text-foreground/80 hover:bg-foreground/4 hover:text-foreground",
          )}
        >
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (!chat.pendingFork) onPin()
            }}
            title={isPinned ? "Unpin" : "Pin"}
            className={cn(
              "flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all duration-150",
              chat.pendingFork && "cursor-default opacity-100 text-muted-foreground/50",
              !chat.pendingFork && (isPinned
                ? isActive
                  ? "text-foreground"
                  : "text-foreground/70"
                : "text-muted-foreground/40 opacity-0 hover:text-foreground group-hover/row:opacity-100"),
            )}
          >
            {chat.pendingFork ? <span className="size-3 animate-spin rounded-full border border-muted-foreground/20 border-t-muted-foreground/70" /> : (
              <Icons.Pin
                size={15}
                strokeWidth={isPinned ? 2 : 1.5}
              />
            )}
          </span>
          <span className="flex-1 truncate text-[13px] font-light">
            {displayName}
          </span>
        </button>
      </SidebarLabelTooltip>

      <div className="absolute right-1 flex h-5 w-5 items-center justify-center">
        <span
          className={cn(
            "pointer-events-none absolute select-none text-[10px] tabular-nums text-muted-foreground/50 transition-opacity duration-100",
            isActive || anyMenuOpen || showRunningIndicator
              ? "opacity-0"
              : "group-hover/row:opacity-0",
          )}
        >
          {timeStr}
        </span>
        {showRunningIndicator && (
          <span
            title="Chat is running"
            className={cn(
              "pointer-events-none absolute flex h-5 w-5 items-center justify-center rounded transition-opacity duration-100",
              anyMenuOpen ? "opacity-0" : "opacity-100 group-hover/row:opacity-0",
            )}
          >
            <span className="size-3 animate-spin rounded-full border border-muted-foreground/25 border-t-foreground/75 dark:border-muted-foreground/30 dark:border-t-foreground/80" />
          </span>
        )}
        {!chat.pendingFork && <Popover open={dotMenuOpen} onOpenChange={handleDotMenuOpenChange}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Chat options"
              className={cn(
                "absolute flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-all duration-100",
                anyMenuOpen
                  ? "text-muted-foreground/60 opacity-100 hover:text-foreground"
                  : showRunningIndicator
                    ? "text-muted-foreground/60 opacity-0 hover:text-foreground group-hover/row:opacity-100"
                    : isActive
                      ? "text-muted-foreground/60 opacity-100 hover:text-foreground"
                      : "text-muted-foreground/50 opacity-0 hover:text-foreground group-hover/row:opacity-100",
              )}
            >
              <Icons.MoreVertical
                size={14}
                strokeWidth={1.5}
              />
            </button>
          </PopoverTrigger>
          <AnimatePresence>
            {dotMenuOpen && (
              <PopoverContent
                forceMount
                align="start"
                side="right"
                sideOffset={4}
                className={cn(
                  "w-44 gap-0 rounded-2xl p-1.5",
                  "border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
                  "backdrop-blur-[40px] backdrop-saturate-[180%]",
                  GLASS_POPOVER,
                )}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{
                    opacity: { duration: 0.2 },
                    scale: MENU_SPRING,
                    y: MENU_SPRING,
                  }}
                  style={{ transformOrigin: "top left" }}
                >
                  <MenuAction
                    label="Rename"
                    icon={
                      <Icons.Edit size={14} strokeWidth={1.5} />
                    }
                    onClick={handleRenameAction}
                  />
                  <div className="my-0.5 h-px bg-border/20" />
                  <MenuAction
                    label="Archive"
                    icon={
                      <Icons.Archive size={14} strokeWidth={1.5} />
                    }
                    onClick={handleArchiveAction}
                  />
                  <MenuAction
                    label="Delete"
                    icon={
                      <Icons.Trash size={14} strokeWidth={1.5} />
                    }
                    onClick={handleDeleteAction}
                    danger
                  />
                </motion.div>
              </PopoverContent>
            )}
          </AnimatePresence>
        </Popover>}
      </div>
    </>
  )

  const content = disableReorder ? (
    <div
      className="group/row relative flex min-w-0 items-center rounded-md"
      style={{ position: "relative" }}
      onContextMenu={handleContextMenu}
    >
      {rowContent}
    </div>
  ) : (
    <Reorder.Item
      value={chatId}
      dragListener={!chat.pendingFork}
      as="div"
      layout="position"
      transition={{
        layout: {
          type: "tween",
          duration: 0.15,
          ease: [0.2, 0, 0, 1],
        },
      }}
      className={cn(
        "group/row relative flex min-w-0 items-center rounded-md",
        !chat.pendingFork && "cursor-grab active:cursor-grabbing",
      )}
      style={{ position: "relative", zIndex: 1, boxShadow: "none" }}
      whileDrag={{ zIndex: 40, scale: 1.015, boxShadow: "none" }}
      onContextMenu={handleContextMenu}
    >
      {rowContent}
    </Reorder.Item>
  )

  return (
    <>
      {content}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {contextMenu.open && (
              <motion.div
                ref={contextMenuRef}
                initial={{ opacity: 0, scale: 0.92, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{
                  opacity: { duration: 0.15 },
                  scale: {
                    type: "spring",
                    stiffness: 400,
                    damping: 28,
                    mass: 0.8,
                  },
                  y: {
                    type: "spring",
                    stiffness: 400,
                    damping: 28,
                    mass: 0.8,
                  },
                }}
                style={{
                  position: "fixed",
                  left: contextMenu.x,
                  top: contextMenu.y,
                  transformOrigin: "top left",
                }}
                className={cn(
                  "z-[120] w-44 rounded-2xl p-1.5",
                  "border border-black/70 bg-[var(--glass-bg)]",
                  "backdrop-blur-[40px] backdrop-saturate-[180%]",
                  "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
                )}
              >
                <MenuAction
                  label="Rename"
                  icon={<Icons.Edit size={14} strokeWidth={1.5} />}
                  onClick={handleRenameAction}
                />
                <div className="my-0.5 h-px bg-border/20" />
                <MenuAction
                  label="Archive"
                  icon={<Icons.Archive size={14} strokeWidth={1.5} />}
                  onClick={handleArchiveAction}
                />
                <MenuAction
                  label="Delete"
                  icon={<Icons.Trash size={14} strokeWidth={1.5} />}
                  onClick={handleDeleteAction}
                  danger
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
