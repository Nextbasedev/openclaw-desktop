"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { VscSearch, VscTerminal } from "react-icons/vsc"
import { usePlatform } from "@/hooks/usePlatform"
import { Icons } from "@/components/icons"
import { ModelSelector } from "@/components/sidebar/ModelSelector"
import { useModels, isActiveModel } from "@/hooks/useModels"

type FooterProps = {
  className?: string
  terminalOpen?: boolean
  onOpenSearch?: () => void
  onToggleTerminal?: () => void
}

export function Footer({ className, onOpenSearch, onToggleTerminal }: FooterProps) {
  const platform = usePlatform()
  const isMac = platform === "macos"
  const modKey = isMac ? "⌘" : "Ctrl"
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const { models, currentModel } = useModels()
  const activeModel = models.find((m) => isActiveModel(currentModel, m))
  const modelLabel = activeModel?.name ?? currentModel ?? "Select model"

  return (
    <footer
      className={cn(
        "relative flex h-[26px] shrink-0 items-center justify-between",
        "border-x-0 border-b-0 border-t border-border/50 bg-card px-3",
        "select-none",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setModelDialogOpen(true)}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5",
          "text-muted-foreground transition-colors",
          "hover:bg-secondary/60 hover:text-foreground",
        )}
      >
        <Icons.Model size={12} className="shrink-0 text-amber-400" />
        <span className="text-[11px]">{modelLabel}</span>
      </button>

      <div className="flex items-center gap-3">
        <ShortcutButton
          icon={<VscSearch className="size-3.5" />}
          keys={[modKey, "K"]}
          label="Search"
          onClick={onOpenSearch}
        />
        <ShortcutButton
          icon={<VscTerminal className="size-3.5" />}
          keys={[modKey, "`"]}
          label="Terminal"
          onClick={onToggleTerminal}
        />
      </div>

      <ModelSelector open={modelDialogOpen} onOpenChange={setModelDialogOpen} />
    </footer>
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
