"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
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

const MENU_SPRING = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
  mass: 0.8,
}

export function GlassDialog({ open, onClose, title, description, children, className }: Props) {
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

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="glass-overlay"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            ref={dialogRef}
            className={cn("glass-dialog", className)}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{
              opacity: { duration: 0.15 },
              scale: MENU_SPRING,
              y: MENU_SPRING,
            }}
            style={{ transformOrigin: "top center" }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0">
                <h2 className="text-[18px] font-semibold leading-tight text-foreground">{title}</h2>
                {description && (
                  <p className="text-[12px] text-muted-foreground">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className={cn(
                  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg",
                  "text-muted-foreground transition-colors",
                  "hover:bg-foreground/8 hover:text-foreground",
                )}
              >
                <Icons.Close size={14} strokeWidth={2} />
              </button>
            </div>

            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
