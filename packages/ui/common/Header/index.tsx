"use client"

import { useState, useCallback } from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { TrafficLights } from "@/components/TrafficLights"
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

                    <span className="rounded-[28px] border border-[#0E283D] bg-gradient-to-br from-[#0E283D] to-[#154F6F] px-2.5 py-0.5 text-[10px] font-bold text-white shadow-inner">
                        {user.version}
                    </span>
                </div>

                {/* Right: action icons */}
                <div className="flex items-center gap-1">
                    <HeaderIconButton
                        icon={Icons.SidebarToggle}
                        label="Toggle sidebar"
                    />
                    <HeaderIconButton
                        icon={Icons.Notification}
                        label="Notifications"
                    />
                    <HeaderIconButton
                        icon={Icons.Settings}
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
    icon: Icon,
    label,
    onClick,
}: {
    icon: React.ElementType
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
                "hover:text-foreground cursor-pointer group/icon",
            )}
        >
            <Icon size={16} strokeWidth={1.5} className="size-4" />
        </button>
    )
}


