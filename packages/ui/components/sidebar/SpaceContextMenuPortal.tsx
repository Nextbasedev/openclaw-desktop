"use client"

import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import type { RefObject } from "react"
import type { Space } from "@/types/space"
import { SpaceActionsMenu } from "./SpaceActionsMenu"

type Props = {
  menuRef: RefObject<HTMLDivElement | null>
  space: Space | null
  x: number
  y: number
  onNewChat: (space: Space) => void
  onRename: (space: Space) => void
  onArchive: (space: Space) => void
  onDelete: (space: Space) => void
}

export function SpaceContextMenuPortal({
  menuRef,
  space,
  x,
  y,
  onNewChat,
  onRename,
  onArchive,
  onDelete,
}: Props) {
  if (typeof document === "undefined" || !space) return null

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: x,
        top: y,
        transformOrigin: "top left",
      }}
      className={cn(
        "z-[120] w-44 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1.5",
        "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
        "backdrop-blur-[40px] backdrop-saturate-[180%]",
      )}
    >
      <SpaceActionsMenu
        space={space}
        onNewChat={onNewChat}
        onRename={onRename}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    </div>,
    document.body,
  )
}
