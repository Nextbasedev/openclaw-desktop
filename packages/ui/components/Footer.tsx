"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { VscSearch, VscTerminal } from "react-icons/vsc"
import { VersionUpdateButton } from "./sidebar/VersionUpdateButton"
import { VersionUpdateModal } from "./sidebar/VersionUpdateModal"

type FooterProps = {
  className?: string
  onToggleTerminal?: () => void
  onDragOpenTerminal?: (height: number) => void
}

export function Footer({ className, onToggleTerminal, onDragOpenTerminal }: FooterProps) {
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startY: number } | null>(null)
  const footerRef = useRef<HTMLElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only respond to clicks on the top border area (top 4px of footer)
    const rect = footerRef.current?.getBoundingClientRect()
    if (!rect) return
    const offsetY = e.clientY - rect.top
    if (offsetY > 4) return

    e.preventDefault()
    dragRef.current = { startY: e.clientY }
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current || !onDragOpenTerminal) return
      const delta = dragRef.current.startY - e.clientY
      if (delta > 30) {
        // Dragged up enough — open terminal with the dragged height
        onDragOpenTerminal(Math.min(600, Math.max(120, delta)))
      }
    }

    function onMouseUp() {
      setIsDragging(false)
      dragRef.current = null
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
  }, [isDragging, onDragOpenTerminal])

  return (
    <>
      <footer
        ref={footerRef}
        onMouseDown={handleMouseDown}
        className={cn(
          "relative flex h-[26px] shrink-0 items-center justify-between",
          "border-t border-border/50 bg-card px-3",
          "select-none cursor-row-resize",
          className,
        )}
      >
        <div>
          <VersionUpdateButton onClick={() => setVersionModalOpen(true)} />
        </div>

        {/* Right: keyboard shortcuts */}
        <div className="flex items-center gap-3">
          <ShortcutButton
            icon={<VscSearch className="size-3.5" />}
            keys={["Ctrl", "K"]}
            label="Search"
          />
          <ShortcutButton
            icon={<VscTerminal className="size-3.5" />}
            keys={["Ctrl", "~"]}
            label="Terminal"
            onClick={onToggleTerminal}
          />
        </div>
      </footer>

      <VersionUpdateModal
        open={versionModalOpen}
        onOpenChange={setVersionModalOpen}
      />

      {isDragging && <div className="fixed inset-0 z-50 cursor-row-resize" />}
    </>
  )
}

/* ── Shortcut button ── */
function ShortcutButton({
  icon,
  keys,
  label,
  onClick,
}: {
  icon: React.ReactNode
  keys: string[]
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5",
        "text-muted-foreground transition-colors",
        "hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {icon}
      <div className="flex items-center gap-0.5">
        {keys.map((key) => (
          <kbd
            key={key}
            className={cn(
              "inline-flex min-w-[18px] items-center justify-center rounded",
              "border border-border/60 bg-secondary/40 px-1 py-px",
              "text-[10px] font-medium text-muted-foreground",
            )}
          >
            {key}
          </kbd>
        ))}
      </div>
    </button>
  )
}
