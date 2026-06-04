"use client"

import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
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
  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {space && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.92, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{
            opacity: { duration: 0.15 },
            scale: { type: "spring", stiffness: 400, damping: 28, mass: 0.8 },
            y: { type: "spring", stiffness: 400, damping: 28, mass: 0.8 },
          }}
          style={{
            position: "fixed",
            left: x,
            top: y,
            transformOrigin: "top left",
          }}
          className={cn(
            "z-[120] w-52 rounded-2xl p-1.5",
            "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
            "backdrop-blur-[40px] backdrop-saturate-[180%]",
            "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          )}
        >
          <SpaceActionsMenu
            space={space}
            onNewChat={onNewChat}
            onRename={onRename}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
