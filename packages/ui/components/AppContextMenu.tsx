"use client"

import { useEffect, type RefObject } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { MenuAction } from "@/components/sidebar/ProjectsSection/MenuAction"

type Props = {
  menuRef: RefObject<HTMLDivElement | null>
  open: boolean
  x: number
  y: number
  onClose: () => void
  onReload: () => void
  onInspectElement?: () => void
}

export function AppContextMenu({
  menuRef,
  open,
  x,
  y,
  onClose,
  onReload,
  onInspectElement,
}: Props) {
  useEffect(() => {
    if (!open) return

    function closeOnPointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("pointerdown", closeOnPointerDown)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [menuRef, onClose, open])

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.06, ease: "easeOut" }}
          style={{
            position: "fixed",
            left: x,
            top: y,
            transformOrigin: "top left",
          }}
          className={cn(
            "z-[130] w-44 rounded-2xl p-1.5",
            "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
            "backdrop-blur-[40px] backdrop-saturate-[180%]",
            "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
          )}
        >
          <MenuAction
            label="Reload"
            icon={<Icons.Refresh size={14} strokeWidth={1.5} />}
            onClick={() => {
              onClose()
              onReload()
            }}
          />
          {onInspectElement ? (
            <MenuAction
              label="Inspect Element"
              icon={<Icons.Wrench size={14} strokeWidth={1.5} />}
              onClick={() => {
                onClose()
                onInspectElement()
              }}
            />
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
