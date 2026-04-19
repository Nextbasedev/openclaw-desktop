"use client"

import { cn } from "@/lib/utils"
import { VscSearch, VscTerminal } from "react-icons/vsc"
import { usePlatform } from "@/hooks/usePlatform"
import { useState } from "react"
import { VersionUpdateButton } from "./sidebar/VersionUpdateButton"
import { VersionUpdateModal } from "./sidebar/VersionUpdateModal"

type FooterProps = {
  className?: string
  onToggleTerminal?: () => void
}

export function Footer({ className, onToggleTerminal }: FooterProps) {
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const platform = usePlatform()
  const isMac = platform === "macos"
  const modKey = isMac ? "⌘" : "Ctrl"

  return (
    <>
      <footer
        className={cn(
          "relative flex h-[26px] shrink-0 items-center justify-between",
          "border-t border-border/50 bg-card px-3",
          "select-none",
          className,
        )}
      >
        <div>
          <VersionUpdateButton onClick={() => setVersionModalOpen(true)} />
        </div>

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
    </>
  )
}

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
        {keys.map((key, i) => (
          <span key={key} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-[9px] text-muted-foreground/50">+</span>}
            <kbd
              className={cn(
                "inline-flex min-w-[18px] items-center justify-center rounded",
                "px-1 py-px",
                "text-[10px]",
              )}
            >
              {key}
            </kbd>
          </span>
        ))}
      </div>
    </button>
  )
}
