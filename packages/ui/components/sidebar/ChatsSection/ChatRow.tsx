"use client"

import { useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { Icons } from "@/components/icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useLongPressDrag } from "@/hooks/useLongPressDrag"
import { MenuAction } from "../ProjectsSection/MenuAction"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { formatCompactTime } from "@/utils/formatCompactTime"
import { chatDisplayName } from "@/utils/chatDisplayName"
import type { Chat } from "@/types/chat"

type Props = {
  chatId: string
  chat: Chat
  isActive: boolean
  isPinned: boolean
  onClick: () => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  disableReorder?: boolean
}

export function ChatRow({
  chatId,
  chat,
  isActive,
  isPinned,
  onClick,
  onPin,
  onRename,
  onArchive,
  onDelete,
  disableReorder,
}: Props) {
  const controls = useDragControls()
  const longPress = useLongPressDrag(controls)
  const [menuOpen, setMenuOpen] = useState(false)

  const timeStr = formatCompactTime(chat.updatedAt)
  const displayName = chatDisplayName(chat)

  const rowContent = (
    <>
      <button
        onClick={onClick}
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
            onPin()
          }}
          title={isPinned ? "Unpin" : "Pin"}
          className={cn(
            "flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all duration-150",
            isPinned
              ? isActive
                ? "text-foreground"
                : "text-foreground/70"
              : "text-muted-foreground/40 opacity-0 hover:text-foreground group-hover/row:opacity-100",
          )}
        >
          <Icons.Pin
            size={15}
            strokeWidth={isPinned ? 2 : 1.5}
          />
        </span>
        <span className="flex-1 truncate text-[13px] font-light">
          {displayName}
        </span>
      </button>

      <div className="absolute right-1 flex h-5 w-5 items-center justify-center">
        <span
          className={cn(
            "pointer-events-none absolute select-none text-[10px] tabular-nums text-muted-foreground/50 transition-opacity duration-100",
            isActive || menuOpen
              ? "opacity-0"
              : "group-hover/row:opacity-0",
          )}
        >
          {timeStr}
        </span>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Chat options"
              className={cn(
                "absolute flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-all duration-100",
                isActive || menuOpen
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
          <PopoverContent
            align="start"
            side="right"
            sideOffset={4}
            className={cn("w-36 gap-0 p-1", GLASS_POPOVER)}
          >
            <MenuAction
              label="Rename"
              icon={
                <Icons.Edit size={14} strokeWidth={1.5} />
              }
              onClick={() => {
                setMenuOpen(false)
                onRename()
              }}
            />
            <div className="my-0.5 h-px bg-border/20" />
            <MenuAction
              label="Archive"
              icon={
                <Icons.Archive size={14} strokeWidth={1.5} />
              }
              onClick={() => {
                setMenuOpen(false)
                onArchive()
              }}
            />
            <MenuAction
              label="Delete"
              icon={
                <Icons.Trash size={14} strokeWidth={1.5} />
              }
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              danger
            />
          </PopoverContent>
        </Popover>
      </div>
    </>
  )

  if (disableReorder) {
    return (
      <div
        className="group/row relative flex min-w-0 items-center rounded-md"
        style={{ position: "relative" }}
      >
        {rowContent}
      </div>
    )
  }

  return (
    <Reorder.Item
      value={chatId}
      dragListener={false}
      dragControls={controls}
      as="div"
      layout="position"
      transition={{
        layout: {
          type: "tween",
          duration: 0.15,
          ease: [0.2, 0, 0, 1],
        },
      }}
      className="group/row relative flex min-w-0 items-center rounded-md"
      style={{ position: "relative", boxShadow: "none" }}
      whileDrag={{ boxShadow: "none" }}
      {...longPress}
    >
      {rowContent}
    </Reorder.Item>
  )
}
