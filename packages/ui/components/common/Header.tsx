"use client"

import { useState, useCallback } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  SidebarLeft01Icon,
  Notification02Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { TrafficLights } from "./TrafficLights"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import type { HeaderUser } from "@/components/settings/settings.config"

type HeaderProps = {
  user?: HeaderUser
  className?: string
}

const DEFAULT_USER: HeaderUser = {
  name: "John Doe",
  version: "V2.03",
}

/**
 * Desktop-style custom header (frameless window titlebar).
 * - data-tauri-drag-region makes it draggable in Tauri
 * - Traffic lights for window controls
 * - User name + version badge on left
 * - Action icons on right (sidebar, notifications, settings)
 */
export function Header({ user = DEFAULT_USER, className }: HeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const openSettings = useCallback(() => setSettingsOpen(true), [])

  return (
    <>
      <header
        data-tauri-drag-region
        className={cn(
          "flex h-10 shrink-0 items-center justify-between",
          "border-b border-border/50 bg-card",
          "select-none px-3",
          className,
        )}
      >
        {/* Left: traffic lights + user + version */}
        <div className="flex items-center gap-3">
          <TrafficLights />

          <span className="text-[13px] font-medium text-foreground">
            {user.name}
          </span>

          <span className="rounded-full border border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            {user.version}
          </span>
        </div>

        {/* Right: action icons */}
        <div className="flex items-center gap-1">
          <HeaderIconButton
            icon={SidebarLeft01Icon}
            label="Toggle sidebar"
          />
          <HeaderIconButton
            icon={Notification02Icon}
            label="Notifications"
          />
          <HeaderIconButton
            icon={Settings02Icon}
            label="Settings"
            onClick={openSettings}
          />
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}

/* ── Reusable icon button for header actions ── */

function HeaderIconButton({
  icon,
  label,
  onClick,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"]
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors",
        "hover:text-foreground hover:bg-muted/50",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  )
}
