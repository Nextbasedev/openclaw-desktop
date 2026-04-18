"use client"

import { cn } from "@/lib/utils"
import { VscSearch, VscTerminal } from "react-icons/vsc"

type FooterProps = {
  className?: string
}

export function Footer({ className }: FooterProps) {
  return (
    <footer
      className={cn(
        "flex h-8 shrink-0 items-center justify-between",
        "border-t border-border/50 bg-card px-3",
        "select-none",
        className,
      )}
    >
      {/* Left: status / placeholder */}
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-chart-1" />
        <span className="text-[11px] text-muted-foreground">Ready</span>
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
        />
      </div>
    </footer>
  )
}

/* ── Shortcut button ── */
function ShortcutButton({
  icon,
  keys,
  label,
}: {
  icon: React.ReactNode
  keys: string[]
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-1.5 py-0.5",
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
