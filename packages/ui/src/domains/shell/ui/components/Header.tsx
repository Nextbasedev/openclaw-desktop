"use client"

import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Settings02Icon,
  Search01Icon,
  Notification02Icon,
  SidebarLeft01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { useSettingsProvider } from "@/src/providers/SettingsProvider"

export function Header() {
  const { open: openSettings } = useSettingsProvider()

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-12 shrink-0 items-center justify-between",
        "px-4",
        // Glassmorphism
        "bg-background/60 backdrop-blur-2xl backdrop-saturate-150",
        "border-b border-border/30",
        "dark:bg-background/40 dark:border-white/[0.06]",
        // Frameless window: make header draggable
        "select-none",
      )}
    >
      {/* Left section — sidebar toggle + branding */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Toggle sidebar"
        >
          <HugeiconsIcon
            icon={SidebarLeft01Icon}
            size={18}
            strokeWidth={1.5}
          />
        </Button>

        <div className="flex items-center gap-2 ml-1">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
            <span className="text-xs font-bold text-primary">OC</span>
          </div>
          <span className="text-sm font-semibold text-foreground tracking-tight">
            OpenClaw
          </span>
        </div>
      </div>

      {/* Center section — search / quick jump */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 px-3 text-xs font-medium",
            "text-muted-foreground hover:text-foreground",
            "rounded-lg",
            "bg-muted/30 hover:bg-muted/50",
            "dark:bg-white/[0.04] dark:hover:bg-white/[0.08]",
          )}
        >
          <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.5} />
          <span>Search or jump to...</span>
          <kbd className="ml-2 inline-flex h-5 items-center rounded border border-border/50 bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      </div>

      {/* Right section — actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label="New topic"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={18} strokeWidth={1.5} />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground relative"
          aria-label="Notifications"
        >
          <HugeiconsIcon
            icon={Notification02Icon}
            size={18}
            strokeWidth={1.5}
          />
          {/* Unread indicator dot */}
          <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-emerald-500" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Settings"
          onClick={() => openSettings()}
        >
          <HugeiconsIcon icon={Settings02Icon} size={18} strokeWidth={1.5} />
        </Button>
      </div>
    </header>
  )
}
