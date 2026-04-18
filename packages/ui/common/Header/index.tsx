"use client"

import { useState, useCallback } from "react"
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff, VscLayoutSidebarRightOff, VscLayoutSidebarRight, VscLayoutPanelOff, VscLayoutPanel } from "react-icons/vsc"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { TrafficLights } from "@/components/TrafficLights"
import { WindowControls } from "@/components/WindowControls"
import { usePlatform } from "@/hooks/usePlatform"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import type { HeaderUser } from "@/components/settings/settings.config"

type HeaderProps = {
    user?: HeaderUser
    className?: string
    inspectorOpen?: boolean
    onToggleInspector?: () => void
    terminalOpen?: boolean
    onToggleTerminal?: () => void
    sidebarOpen?: boolean
    onToggleSidebar?: () => void
    centerLabel?: string | null
}

const DEFAULT_USER: HeaderUser = {
    name: "John Doe",
    version: "V2.03",
}

export function Header({
    user = DEFAULT_USER,
    className,
    inspectorOpen = false,
    onToggleInspector,
    terminalOpen = false,
    onToggleTerminal,
    sidebarOpen = true,
    onToggleSidebar,
    centerLabel,
}: HeaderProps) {
    const [settingsOpen, setSettingsOpen] = useState(false)
    const platform = usePlatform()

    const isMac = platform === "macos"
    const isWindows = platform === "windows" || platform === "linux"

    const openSettings = useCallback(() => setSettingsOpen(true), [])

    return (
        <>
            <header
                className={cn(
                    "relative flex h-9 shrink-0 items-center justify-between",
                    "border-b border-border/50 bg-card",
                    "select-none",
                    isWindows ? "pl-3 pr-0" : "px-3",
                    className,
                )}
            >
                <div data-tauri-drag-region className="absolute inset-0 z-0" />

                {/* ── Center label (active project › topic) ── */}
                {centerLabel && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                        <span className="max-w-[40%] truncate text-center text-[12px] font-medium text-foreground/55 tracking-tight">
                            {centerLabel}
                        </span>
                    </div>
                )}

                <div className="relative z-10 flex items-center gap-3">
                    {isMac && <TrafficLights />}

                    <span className="text-[13px] font-medium text-foreground">
                        {user.name}
                    </span>

                    <span className="rounded-[28px] border border-[#0E283D] bg-linear-to-br from-[#0E283D] to-[#154F6F] px-2.5 py-0.5 text-[10px] font-bold text-white shadow-inner">
                        {user.version}
                    </span>
                </div>

                <div className="relative z-10 flex items-center gap-0">
                    <button
                        type="button"
                        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                        onClick={onToggleSidebar}
                        className={cn(
                            "flex size-7 items-center justify-center rounded-md",
                            "transition-colors cursor-pointer",
                            sidebarOpen
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {sidebarOpen ? (
                            <VscLayoutSidebarLeft className="size-4" />
                        ) : (
                            <VscLayoutSidebarLeftOff className="size-4" />
                        )}
                    </button>

                    <button
                        type="button"
                        aria-label="Toggle terminal"
                        title="Toggle terminal"
                        onClick={onToggleTerminal}
                        className={cn(
                            "flex size-7 items-center justify-center rounded-md",
                            "transition-colors cursor-pointer",
                            terminalOpen
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {terminalOpen ? (
                            <VscLayoutPanel className="size-4" />
                        ) : (
                            <VscLayoutPanelOff className="size-4" />
                        )}
                    </button>
                    <button
                        type="button"
                        aria-label="Toggle inspector panel"
                        title="Toggle inspector panel"
                        onClick={onToggleInspector}
                        className={cn(
                            "flex size-7 items-center justify-center rounded-md",
                            "transition-colors cursor-pointer",
                            inspectorOpen
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {inspectorOpen ? (
                            <VscLayoutSidebarRight className="size-4" />
                        ) : (
                            <VscLayoutSidebarRightOff className="size-4" />
                        )}
                    </button>
                    <HeaderIconButton
                        icon={Icons.Notification}
                        label="Notifications"
                    />
                    <HeaderIconButton
                        icon={Icons.Settings}
                        label="Settings"
                        onClick={openSettings}
                    />

                    {isWindows && <WindowControls className="ml-2" />}
                </div>
            </header>

            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
    )
}

function HeaderIconButton({
    icon: Icon,
    label,
    onClick,
    active,
}: {
    icon: React.ElementType
    label: string
    onClick?: () => void
    active?: boolean
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={cn(
                "flex size-7 items-center justify-center rounded-md",
                "transition-colors cursor-pointer group/icon",
                active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
            )}
        >
            <Icon size={16} strokeWidth={1.5} className="size-4" />
        </button>
    )
}
