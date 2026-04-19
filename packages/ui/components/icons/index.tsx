"use client"

import React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
    Notification02Icon,
    Settings02Icon,
    Menu01Icon,
    Cancel01Icon,
    Search01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Tick01Icon,
    UserCircleIcon,
    HelpCircleIcon,
    LayoutLeftIcon,
    LayoutRightIcon,
    DashboardSpeed01Icon,
    Message01Icon,
    TerminalIcon,
    FolderAddIcon,
    Database01Icon,
    PencilEdit02Icon,
    AlarmClockIcon,
    Home01Icon,
    Clock01Icon,
    Task01Icon,
    Mail01Icon,
    Sun01Icon,
    Moon01Icon,
    ComputerIcon,
    Download04Icon,
    File01Icon,
    BubbleChatIcon,
    Globe02Icon,
    UserAccountIcon,
    Wrench01Icon,
    GridIcon,
    ArrowUpRight01Icon,
    MinusSignIcon,
    Add01Icon,
    PowerIcon,
    PlayIcon,
    PauseIcon,
    StopIcon,
    PinIcon,
    PinOffIcon,
    MoreVerticalIcon,
    Delete02Icon,
    Archive02Icon,
} from "@hugeicons/core-free-icons"
import { VscLayoutSidebarRightOff } from "react-icons/vsc"

/**
 * Global Icons System
 * 
 * This file centralizes all icons used in the application.
 * It abstracts the source (Hugeicons, React Icons, or Custom SVGs)
 * into a consistent component-based API.
 */

export interface IconProps extends React.SVGProps<SVGSVGElement> {
    size?: number | string
    strokeWidth?: number
}

const wrapHugeicon = (IconData: any) => {
    const Component = ({ size = 20, strokeWidth = 1.5, className, ...props }: IconProps) => (
        <HugeiconsIcon
            icon={IconData}
            size={size}
            strokeWidth={strokeWidth}
            className={className}
            {...props as any}
        />
    )
    Component.displayName = `Hugeicon(${IconData.name || 'Unknown'})`
    return Component
}

// Map React Icons to our standard props if needed, but usually they are already compatible
const wrapReactIcon = (IconComponent: React.ElementType) => {
    const Component = ({ size = 20, className, ...props }: IconProps) => (
        <IconComponent size={size} className={className} {...props} />
    )
    Component.displayName = `ReactIcon(${(IconComponent as any).displayName || (IconComponent as any).name || 'Unknown'})`
    return Component
}

export const Icons = {
    // Navigation
    Home: wrapHugeicon(Home01Icon),
    Dashboard: wrapHugeicon(DashboardSpeed01Icon),
    Chat: wrapHugeicon(Message01Icon),
    Terminal: wrapHugeicon(TerminalIcon),
    Files: wrapHugeicon(FolderAddIcon),
    Memory: wrapHugeicon(Database01Icon),
    Cron: wrapHugeicon(AlarmClockIcon),
    Tasks: wrapHugeicon(Task01Icon),
    Inbox: wrapHugeicon(Mail01Icon),

    // Layout
    SidebarLeft: wrapHugeicon(LayoutLeftIcon),
    SidebarRight: wrapHugeicon(LayoutRightIcon),
    SidebarToggle: wrapReactIcon(VscLayoutSidebarRightOff),

    // Sidebar Specific
    NewChat: wrapHugeicon(PencilEdit02Icon),
    Plugins: wrapHugeicon(GridIcon),
    Automations: wrapHugeicon(Clock01Icon),
    Project: wrapHugeicon(FolderAddIcon),

    // Actions
    Edit: wrapHugeicon(PencilEdit02Icon),
    Add: wrapHugeicon(Add01Icon),
    Check: wrapHugeicon(Tick01Icon),
    Close: wrapHugeicon(Cancel01Icon),
    Search: wrapHugeicon(Search01Icon),
    Back: wrapHugeicon(ArrowLeft01Icon),
    Forward: wrapHugeicon(ArrowRight01Icon),
    Menu: wrapHugeicon(Menu01Icon),
    Refresh: wrapHugeicon(Clock01Icon),

    // System
    Notification: wrapHugeicon(Notification02Icon),
    Settings: wrapHugeicon(Settings02Icon),
    User: wrapHugeicon(UserCircleIcon),
    Help: wrapHugeicon(HelpCircleIcon),
    Sun: wrapHugeicon(Sun01Icon),
    Moon: wrapHugeicon(Moon01Icon),
    System: wrapHugeicon(ComputerIcon),
    Download: wrapHugeicon(Download04Icon),
    File: wrapHugeicon(File01Icon),
    BubbleChat: wrapHugeicon(BubbleChatIcon),
    Globe: wrapHugeicon(Globe02Icon),
    UserAccount: wrapHugeicon(UserAccountIcon),
    Wrench: wrapHugeicon(Wrench01Icon),
    Grid: wrapHugeicon(GridIcon),
    ExternalLink: wrapHugeicon(ArrowUpRight01Icon),
    Minus: wrapHugeicon(MinusSignIcon),
    Plus: wrapHugeicon(Add01Icon),

    // Media/State
    Power: wrapHugeicon(PowerIcon),
    Play: wrapHugeicon(PlayIcon),
    Pause: wrapHugeicon(PauseIcon),
    Stop: wrapHugeicon(StopIcon),

    // Context menus / pins
    Pin: wrapHugeicon(PinIcon),
    PinOff: wrapHugeicon(PinOffIcon),
    MoreVertical: wrapHugeicon(MoreVerticalIcon),
    Trash: wrapHugeicon(Delete02Icon),
    Archive: wrapHugeicon(Archive02Icon),
}

/**
 * Example of using a "Normal SVG" in the Icons registry.
 * You can paste raw SVG code here and wrap it in a standard component.
 */
export const CustomLogo = ({ size = 24, className, ...props }: IconProps) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
    >
        <circle cx="12" cy="12" r="10" />
        <path d="m16 8-8 8" />
        <path d="m8 8 8 8" />
    </svg>
)

export type IconName = keyof typeof Icons
