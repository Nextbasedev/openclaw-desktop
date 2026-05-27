"use client"

import { useEffect, type RefObject } from "react"
import { createPortal } from "react-dom"
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
}

export function AppContextMenu({
  menuRef,
  open,
  x,
  y,
  onClose,
  onReload,
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

  if (typeof document === "undefined" || !open) return null

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
        "z-[130] w-44 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1",
        "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
        "backdrop-blur-[40px] backdrop-saturate-[180%]",
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
    </div>,
    document.body,
  )
}
