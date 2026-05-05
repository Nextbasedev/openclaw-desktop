"use client"

import { useEffect, useRef, useState } from "react"
import {
  VscAdd,
  VscClose,
  VscLayoutSidebarLeft,
  VscLayoutSidebarRight,
  VscOutput,
  VscSplitHorizontal,
  VscTerminal,
} from "react-icons/vsc"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { TrafficLights } from "@/components/TrafficLights"
import { WindowControls } from "@/components/WindowControls"
import { usePlatform } from "@/hooks/usePlatform"
import type { HeaderUser } from "@/components/settings/settings.config"
import { NotificationPopover } from "@/components/notifications/NotificationPopover"
import { invoke } from "@/lib/ipc"
import type { ActiveChat } from "@/types/chat"
import type { EditorTab, EditorGroupsState } from "@/lib/editorGroups"

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
  sidebarReservedWidth?: number
  editorGroups?: EditorGroupsState | null
  onSelectChatTab?: (groupId: "group-1" | "group-2", tabId: string) => void
  onCloseChatTab?: (id: string) => void
  onNewChat?: () => void
  showSplitButton?: boolean
  splitActive?: boolean
  onToggleSplit?: () => void
  onOpenSettings?: () => void
  onOpenNotifications?: () => void
  onOpenLogs?: () => void
  onNavigateToChat?: (
    chat: ActiveChat,
  ) => void | boolean | Promise<void | boolean>
}

const DEFAULT_USER: HeaderUser = {
  name: "OpenClaw",
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
  sidebarReservedWidth = 0,
  editorGroups = null,
  onSelectChatTab,
  onCloseChatTab,
  onNewChat,
  showSplitButton = false,
  splitActive = false,
  onToggleSplit,
  onOpenSettings,
  onOpenNotifications,
  onOpenLogs,
  onNavigateToChat,
}: HeaderProps) {
  const platform = usePlatform()
  const [isTauri, setIsTauri] = useState(false)
  const [openClawVersion, setOpenClawVersion] = useState<string | null>(null)
  const [nodeVersion, setNodeVersion] = useState<string | null>(null)
  const rightClusterRef = useRef<HTMLDivElement>(null)
  const [rightClusterWidth, setRightClusterWidth] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsTauri(
        typeof window !== "undefined" && !!window.__TAURI_INTERNALS__,
      )
    }, 0)
    return () => window.clearTimeout(timer)
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

  useEffect(() => {
    const el = rightClusterRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setRightClusterWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasVisibleTabs = editorGroups?.groups.some((g) =>
    g.tabs.some((t) => t.kind !== "draft"),
  )

  return (
    <header
      className={cn(
        "relative z-50 flex h-9 shrink-0 items-center",
        "bg-card",
        "select-none",
        className,
      )}
    >
      {isTauri && (
        <div data-tauri-drag-region className="absolute inset-0 z-0" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-px bg-border/50" />

      {/* Left: app name + version — minWidth matches sidebar so tabs align with content panes */}
      <div
        className="relative z-10 flex shrink-0 items-center gap-3 overflow-hidden px-3"
        style={sidebarReservedWidth > 0 ? { minWidth: sidebarReservedWidth } : undefined}
      >
        {showTrafficLights && <TrafficLights />}

        <span className="text-[13px] font-medium text-foreground">
          {user.name}
        </span>

        {openClawVersion && (
          <span
            title={
              nodeVersion ? `Middleware Node ${nodeVersion}` : undefined
            }
            className="rounded-[28px] border border-[#0E283D] bg-linear-to-br from-[#0E283D] to-[#154F6F] px-2.5 py-0.5 text-[10px] font-bold text-white shadow-inner"
          >
            v{openClawVersion}
          </span>
        )}
      </div>

      {/* Middle: tabs — flex-1 matches content area width, paddingRight keeps tabs visible */}
      {hasVisibleTabs && editorGroups ? (
        <div className="relative z-10 flex min-w-0 flex-1 items-end self-end">
          {editorGroups.groups.map((group, groupIndex) => {
            const visibleTabs = group.tabs.filter((t) => t.kind !== "draft")
            if (visibleTabs.length === 0) return null
            const isFocusedGroup = group.id === editorGroups.focusedGroupId
            const isLastGroup = groupIndex === editorGroups.groups.length - 1
            return (
              <div
                key={group.id}
                className="flex min-w-0 flex-1 items-end"
                style={
                  isLastGroup && rightClusterWidth > 0
                    ? { paddingRight: rightClusterWidth + 8 }
                    : undefined
                }
              >
                {groupIndex > 0 && (
                  <div className="flex h-[34px] shrink-0 items-center px-0.5">
                    <div className="h-4 w-px bg-border/50" />
                  </div>
                )}
                <div
                  onWheel={(event) => {
                    const target = event.currentTarget
                    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                      target.scrollLeft += event.deltaY
                    }
                  }}
                  className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth scrollbar-hide"
                >
                  {visibleTabs.map((tab) => (
                    <HeaderTab
                      key={tab.id}
                      tab={tab}
                      isActive={group.activeTabId === tab.id}
                      isFocusedGroup={isFocusedGroup}
                      onSelect={() => onSelectChatTab?.(group.id, tab.id)}
                      onClose={() => onCloseChatTab?.(tab.id)}
                    />
                  ))}
                  {isFocusedGroup && onNewChat && (
                    <button
                      type="button"
                      aria-label="New chat"
                      title="New chat"
                      onClick={(event) => {
                        event.stopPropagation()
                        onNewChat()
                      }}
                      className="mb-[7px] ml-2 mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80 dark:text-white/45 dark:hover:bg-white/[0.07] dark:hover:text-white/82"
                    >
                      <VscAdd className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Right: action icons — absolute so they don't shrink the tab area */}
      <div ref={rightClusterRef} className={cn("absolute right-0 top-0 z-20 flex h-full items-center gap-0 bg-card pl-2", showWindowControls ? "pr-0" : "pr-3")}>
        {!minimal && (
          <>
            {showSplitButton && (
              <button
                type="button"
                aria-label={
                  splitActive ? "Close split view" : "Split editor"
                }
                title={
                  splitActive ? "Close split view" : "Split editor"
                }
                onClick={onToggleSplit}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md",
                  "cursor-pointer transition-colors",
                  splitActive
                    ? "text-foreground"
                    : "bg-transparent text-[#A3A3A9] hover:text-[#C6C6CC] dark:text-[#A3A3A9] dark:hover:text-[#D3D3D9]",
                )}
              >
                <VscSplitHorizontal className="size-4" />
              </button>
            )}

            <button
              type="button"
              data-testid="toggle-sidebar"
              aria-label={
                sidebarOpen ? "Collapse sidebar" : "Expand sidebar"
              }
              title={
                sidebarOpen ? "Collapse sidebar" : "Expand sidebar"
              }
              onClick={onToggleSidebar}
              className={cn(
                "flex size-7 items-center justify-center rounded-md",
                "cursor-pointer transition-colors",
                sidebarOpen
                  ? "bg-transparent text-foreground"
                  : "bg-transparent text-[#A3A3A9] hover:text-[#C6C6CC] dark:text-[#A3A3A9] dark:hover:text-[#D3D3D9]",
              )}
            >
              <VscLayoutSidebarLeft className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Toggle inspector panel"
              title="Toggle inspector panel"
              onClick={onToggleInspector}
              className={cn(
                "flex size-7 items-center justify-center rounded-md",
                "cursor-pointer transition-colors",
                inspectorOpen
                  ? "bg-transparent text-foreground"
                  : "bg-transparent text-[#A3A3A9] hover:text-[#C6C6CC] dark:text-[#A3A3A9] dark:hover:text-[#D3D3D9]",
              )}
            >
              <VscLayoutSidebarRight className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Toggle terminal"
              title="Toggle terminal"
              onClick={onToggleTerminal}
              className={cn(
                "flex size-7 items-center justify-center rounded-md",
                "cursor-pointer transition-colors",
                terminalOpen
                  ? "bg-transparent text-foreground"
                  : "bg-transparent text-[#A3A3A9] hover:text-[#C6C6CC] dark:text-[#A3A3A9] dark:hover:text-[#D3D3D9]",
              )}
            >
              <VscTerminal className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Open logs"
              title="Open logs"
              onClick={onOpenLogs}
              className={cn(
                "mx-1 flex items-center gap-1.5 rounded-md border border-border/40 px-2 py-1 text-[11px]",
                "cursor-pointer transition-colors",
                "text-muted-foreground hover:text-foreground",
              )}
            >
              <VscOutput className="size-3.5" />
              Logs
            </button>

            <NotificationPopover
              onViewAll={onOpenNotifications}
              onNavigateToChat={onNavigateToChat}
            />
            <HeaderIconButton
              icon={Icons.Settings}
              label="Settings"
              onClick={onOpenSettings}
            />
          </>
        )}

        {showWindowControls && (
          <WindowControls className={minimal ? "" : "ml-2"} />
        )}
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
        "cursor-pointer transition-colors group/icon",
        active
          ? "bg-transparent text-foreground"
          : "bg-transparent text-[#A3A3A9] hover:text-[#C6C6CC] dark:text-[#A3A3A9] dark:hover:text-[#D3D3D9]",
      )}
    >
      <Icon size={16} strokeWidth={1.5} className="size-4" />
    </button>
  )
}

function HeaderTab({
  tab,
  isActive,
  isFocusedGroup = true,
  onSelect,
  onClose,
}: {
  tab: EditorTab
  isActive: boolean
  isFocusedGroup?: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const activeAndFocused = isActive && isFocusedGroup
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative mb-[3px] flex h-[30px] w-40 shrink-0 items-center gap-1.5 rounded-t-xl border border-b-0 px-3 text-left transition-[background-color,border-color,box-shadow,opacity] duration-200",
        activeAndFocused
          ? "z-10 border-white/10 bg-background text-foreground shadow-[0_1px_0_0_var(--background),0_-1px_10px_rgba(0,0,0,0.18)]"
          : isActive
            ? "z-10 border-white/8 bg-background/70 text-foreground/72 shadow-[0_1px_0_0_var(--background)]"
            : "border-transparent bg-black/[0.16] text-foreground/56 hover:bg-white/[0.035] hover:text-foreground/74 dark:bg-white/[0.025] dark:text-white/58 dark:hover:bg-white/[0.055] dark:hover:text-white/76",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -left-2 bottom-0 h-3 w-2 rounded-br-xl border-b border-r opacity-0",
          activeAndFocused && "border-white/10 opacity-100",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-2 bottom-0 h-3 w-2 rounded-bl-xl border-b border-l opacity-0",
          activeAndFocused && "border-white/10 opacity-100",
        )}
      />
      <div
        className={cn(
          "flex size-4.5 shrink-0 items-center justify-center rounded-full",
          isActive
            ? "bg-foreground/[0.06] text-foreground/58 dark:bg-white/[0.06] dark:text-white/62"
            : "bg-transparent text-foreground/34 dark:text-white/36",
        )}
      >
        {tab.kind === "topic" ? (
          <Icons.Project
            size={12}
            strokeWidth={1.7}
            className="size-3.5"
          />
        ) : (
          <Icons.Chat
            size={12}
            strokeWidth={1.7}
            className="size-3.5"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span
            className={cn(
              "truncate text-[10.5px]",
              isActive
                ? "text-foreground/36 dark:text-white/38"
                : "text-foreground/28 dark:text-white/28",
            )}
          >
            {tab.subtitle}
          </span>
          <span className="shrink-0 text-[10px] text-foreground/20 dark:text-white/20">
            /
          </span>
          <span
            className={cn(
              "truncate text-[11.5px] font-medium",
              activeAndFocused
                ? "text-foreground/86 dark:text-white/88"
                : isActive
                  ? "text-foreground/66 dark:text-white/68"
                  : "text-foreground/64 dark:text-white/66",
            )}
          >
            {tab.title}
          </span>
        </div>
      </div>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        className={cn(
          "ml-1 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
          isActive
            ? "text-foreground/36 hover:bg-foreground/[0.06] hover:text-foreground/72 dark:text-white/36 dark:hover:bg-white/[0.06] dark:hover:text-white/72"
            : "text-foreground/28 hover:bg-foreground/[0.05] hover:text-foreground/58 dark:text-white/28 dark:hover:bg-white/[0.05] dark:hover:text-white/58",
        )}
      >
        <VscClose className="size-3.5" />
      </span>
    </button>
  )
}
