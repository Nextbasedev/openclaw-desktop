"use client"

import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

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
      {/* Left: status */}
      <div className="flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[11px] text-muted-foreground">Ready</span>
      </div>

      {/* Right: keyboard shortcuts */}
      <div className="flex items-center gap-2">
        <ShortcutButton
          icon={<Icons.Search size={13} strokeWidth={1.8} />}
          keys={["Ctrl", "K"]}
          label="Search"
        />
        <span className="h-3 w-px bg-border/40" />
        <ShortcutButton
          icon={<Icons.Terminal size={13} strokeWidth={1.8} />}
          keys={["Ctrl", "~"]}
          label="Terminal"
        />
      </div>
    </footer>
  )
}

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
