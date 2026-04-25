"use client"

import { useEffect, useState } from "react"
import { VscLayoutSidebarLeft, VscLayoutSidebarLeftOff, VscLayoutSidebarRightOff, VscLayoutSidebarRight, VscTerminal } from "react-icons/vsc"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { TrafficLights } from "@/components/TrafficLights"
import { WindowControls } from "@/components/WindowControls"
import { usePlatform } from "@/hooks/usePlatform"
import type { HeaderUser } from "@/components/settings/settings.config"
import { NotificationPopover } from "@/components/notifications/NotificationPopover"
import { invoke } from "@/lib/ipc"
import type { ActiveChat } from "@/types/chat"

type VersionInfo = {
    version: string
    nodeVersion?: string
    openclawVersion?: string | null
    source?: string
}

type HeaderProps = {
    user?: HeaderUser
    className?: string
    minimal?: boolean
    inspectorOpen?: boolean
    onToggleInspector?: () => void
    terminalOpen?: boolean
    onToggleTerminal?: () => void
    sidebarOpen?: boolean
    onToggleSidebar?: () => void
    chatMode?: "simple" | "mission"
    onChatModeChange?: (mode: "simple" | "mission") => void
    centerLabel?: { project: string; topic: string } | null
    onOpenSettings?: () => void
    onOpenNotifications?: () => void
    onNavigateToChat?: (chat: ActiveChat) => void | boolean | Promise<void | boolean>
}

const DEFAULT_USER: HeaderUser = {
    name: "Jarvis",
}

export function Header({
    user = DEFAULT_USER,
    className,
    minimal = false,
    inspectorOpen = false,
    onToggleInspector,
    terminalOpen = false,
    onToggleTerminal,
    sidebarOpen = true,
    onToggleSidebar,
    chatMode = "simple",
    onChatModeChange,
    centerLabel,
    onOpenSettings,
    onOpenNotifications,
    onNavigateToChat,
}: HeaderProps) {
    const platform = usePlatform()
    const [isTauri, setIsTauri] = useState(false)
    const [openClawVersion, setOpenClawVersion] = useState<string | null>(null)
    const [nodeVersion, setNodeVersion] = useState<string | null>(null)

    useEffect(() => {
        setIsTauri(typeof window !== "undefined" && !!window.__TAURI_INTERNALS__)
    }, [])

    useEffect(() => {
        invoke<VersionInfo>("middleware_version_info")
            .then((res) => {
                setOpenClawVersion(res.openclawVersion ?? res.version)
                setNodeVersion(res.nodeVersion ?? null)
            })
            .catch(() => {})
    }, [])

    const isMac = platform === "macos"
    const isWindows = platform === "windows" || platform === "linux"
    const showTrafficLights = isTauri && isMac
    const showWindowControls = isTauri && isWindows

    return (
        <header
            className={cn(
                "relative flex h-9 shrink-0 items-center justify-between",
                "border-b border-border/50 bg-card",
                "select-none",
                showWindowControls ? "pl-3 pr-0" : "px-3",
                className,
            )}
        >
            {isTauri && <div data-tauri-drag-region className="absolute inset-0 z-0" />}

            {/* ── Center label (active project › topic) ── */}
            {centerLabel && (
                <div data-center-label="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1">
                    <span className="truncate text-[11.5px] text-foreground/35">
                        {centerLabel.project}
                    </span>
                    <span className="text-[11px] text-foreground/20">/</span>
                    <span className="truncate text-[11.5px] font-medium text-foreground/60">
                        {centerLabel.topic}
                    </span>
                </div>
            )}

            <div className="relative z-10 flex items-center gap-3">
                {showTrafficLights && <TrafficLights />}

                <span className="text-[13px] font-medium text-foreground">
                    {user.name}
                </span>

                {openClawVersion && (
                    <span
                        title={nodeVersion ? `Middleware Node ${nodeVersion}` : undefined}
                        className="rounded-[28px] border border-[#0E283D] bg-linear-to-br from-[#0E283D] to-[#154F6F] px-2.5 py-0.5 text-[10px] font-bold text-white shadow-inner"
                    >
                        v{openClawVersion}
                    </span>
                )}
            </div>

            <div className="relative z-10 flex items-center gap-0">
                {!minimal && (
                    <>
                        <button
                            type="button"
                            data-testid="toggle-sidebar"
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
                            aria-label={
                                chatMode === "simple"
                                    ? "Show what's happening"
                                    : "Hide activity panels"
                            }
                            title={
                                chatMode === "simple"
                                    ? "Show what's happening"
                                    : "Hide activity panels"
                            }
                            onClick={() =>
                                onChatModeChange?.(
                                    chatMode === "simple" ? "mission" : "simple",
                                )
                            }
                            className={cn(
                                "mx-1 rounded-md border border-border/40 px-2 py-1 text-[11px]",
                                "cursor-pointer transition-colors",
                                chatMode === "mission"
                                    ? "bg-foreground/10 text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {chatMode === "simple" ? "Show activity" : "Mission"}
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
                            <VscTerminal className="size-4" />
                        </button>

                        <NotificationPopover onViewAll={onOpenNotifications} onNavigateToChat={onNavigateToChat} />
                        <HeaderIconButton
                            icon={Icons.Settings}
                            label="Settings"
                            onClick={onOpenSettings}
                        />
                    </>
                )}

                {showWindowControls && <WindowControls className={minimal ? "" : "ml-2"} />}
            </div>
        </header>
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
