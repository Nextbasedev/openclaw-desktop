"use client"

import { useCallback, useEffect, useRef, } from "react"
import { cn } from "@/lib/utils"
import { VscSearch, VscTerminal } from "react-icons/vsc"
import { usePlatform } from "@/hooks/usePlatform"
import { useState } from "react"
import { VersionUpdateButton } from "./sidebar/VersionUpdateButton"
import { VersionUpdateModal } from "./sidebar/VersionUpdateModal"

type FooterProps = {
  className?: string
  terminalOpen?: boolean
  onToggleTerminal?: () => void
  onDragOpenTerminal?: (height: number) => void
}

export function Footer({ className, terminalOpen = false, onToggleTerminal, onDragOpenTerminal }: FooterProps) {
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const platform = usePlatform()
  const isMac = platform === "macos"
  const modKey = isMac ? "⌘" : "Ctrl"
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startY: number } | null>(null)
  const footerRef = useRef<HTMLElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (terminalOpen) return

    const rect = footerRef.current?.getBoundingClientRect()
    if (!rect) return
    const offsetY = e.clientY - rect.top
    if (offsetY > 4) return

    e.preventDefault()
    dragRef.current = { startY: e.clientY }
    setIsDragging(true)
  }, [terminalOpen])

  useEffect(() => {
    if (!isDragging) return

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current || !onDragOpenTerminal) return
      const delta = dragRef.current.startY - e.clientY
      if (delta > 8) {
        onDragOpenTerminal(Math.min(600, Math.max(120, delta)))
        setIsDragging(false)
        dragRef.current = null
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
          terminalOpen ? "select-none" : "select-none cursor-row-resize",
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
          keys={[modKey, "K"]}
          label="Search"
        />
        <ShortcutButton
          icon={<VscTerminal className="size-3.5" />}
          keys={[modKey, "`"]}
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
