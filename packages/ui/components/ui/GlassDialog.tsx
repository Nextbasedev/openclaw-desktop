"use client"

import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function GlassDialog({ open, onClose, title, description, children, className }: Props) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="glass-overlay"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className={cn("glass-dialog", className)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0">
            <h2 id={titleId} className="text-[18px] font-semibold leading-tight text-foreground">{title}</h2>
            {description && (
              <p id={descriptionId} className="text-[12px] text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg cursor-pointer",
              "text-muted-foreground transition-colors",
              "hover:bg-foreground/8 hover:text-foreground",
            )}
          >
            <Icons.Close size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        {children}
      </div>
    </div>,
    document.body,
  )
}
