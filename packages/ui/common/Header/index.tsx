"use client"

import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react"
import { motion } from "framer-motion"
import {
  VscAdd,
  VscClose,
  VscLayoutSidebarLeft,
  VscLayoutSidebarRight,
  VscOutput,
  VscSplitHorizontal,
  VscTerminal,
} from "react-icons/vsc"
import { LuExternalLink } from "react-icons/lu"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { TrafficLights } from "@/components/TrafficLights"
import { WindowControls } from "@/components/WindowControls"
import { usePlatform } from "@/hooks/usePlatform"
import type { HeaderUser } from "@/components/settings/settings.config"
import { NotificationPopover } from "@/components/notifications/NotificationPopover"
import { invoke } from "@/lib/ipc"
import { dedupeRequest } from "@/lib/requestDedupe"
import { openRouteInNewWindow } from "@/lib/openRouteWindow"
import type { ActiveChat } from "@/types/chat"
import type { EditorTab, EditorGroupsState } from "@/lib/editorGroups"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GLASS_POPOVER } from "@/constants/glassPopover"

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
  onOpenChatTabWindow?: (tab: EditorTab) => void
  onMoveChatTab?: (
    tabId: string,
    sourceGroupId: "group-1" | "group-2",
    targetGroupId: "group-1" | "group-2",
    targetIndex?: number,
  ) => void
  onNewChat?: (groupId?: "group-1" | "group-2") => void
  showSplitButton?: boolean
  splitActive?: boolean
  splitRatio?: number
  onToggleSplit?: () => void
  onOpenSettings?: () => void
  onOpenNotifications?: () => void
  onOpenLogs?: () => void
  useNativeWindowChrome?: boolean
  onNavigateToChat?: (
    chat: ActiveChat,
  ) => void | boolean | Promise<void | boolean>
}

const DEFAULT_USER: HeaderUser = {
  name: "OpenClaw",
}

function isWindowDragExcludedTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true
  return Boolean(
    target.closest(
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[contenteditable='true']",
        "[draggable='true']",
        "[data-window-drag-exclude='true']",
      ].join(","),
    ),
  )
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
  onOpenChatTabWindow,
  onMoveChatTab,
  onNewChat,
  showSplitButton = false,
  splitActive = false,
  splitRatio = 0.5,
  onToggleSplit,
  onOpenSettings,
  onOpenNotifications,
  onOpenLogs,
  useNativeWindowChrome = false,
  onNavigateToChat,
}: HeaderProps) {
  const platform = usePlatform()
  const [isTauri, setIsTauri] = useState(false)
  const [openClawVersion, setOpenClawVersion] = useState<string | null>(null)
  const [nodeVersion, setNodeVersion] = useState<string | null>(null)
  const rightClusterRef = useRef<HTMLDivElement>(null)
  const [rightClusterWidth, setRightClusterWidth] = useState(0)
  const [dragOverGroupId, setDragOverGroupId] = useState<"group-1" | "group-2" | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsTauri(
        typeof window !== "undefined" && !!window.__TAURI_INTERNALS__,
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    dedupeRequest(
      "global:middleware_version_info",
      () => invoke<VersionInfo>("middleware_version_info"),
      { ttlMs: 120_000 },
    )
      .then((res) => {
        setOpenClawVersion(res.openclawVersion ?? res.version)
        setNodeVersion(res.nodeVersion ?? null)
      })
      .catch(() => {})
  }, [])

  const isMac = platform === "macos"
  const isWindows = platform === "windows" || platform === "linux"
  const showTrafficLights = isTauri && isMac && !useNativeWindowChrome
  const showWindowControls = isTauri && isWindows && !useNativeWindowChrome

  useEffect(() => {
    const el = rightClusterRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setRightClusterWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasVisibleTabs = Boolean(editorGroups?.groups.some((g) => g.tabs.length > 0))
  const isSplitTabs = (editorGroups?.groups.length ?? 0) > 1

  const handleHeaderMouseDown = async (event: MouseEvent<HTMLElement>) => {
    if (!isTauri || useNativeWindowChrome || event.button !== 0) return
    if (isWindowDragExcludedTarget(event.target)) return

    try {
      event.preventDefault()
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      await getCurrentWindow().startDragging()
    } catch {
      // Browser/dev mode or unsupported platform: keep normal header behavior.
    }
  }

  return (
    <header
      onMouseDown={handleHeaderMouseDown}
      className={cn(
        "relative z-50 flex h-11 shrink-0 items-center",
        "bg-[#151515]",
        "select-none",
        className,
      )}
    >
      {isTauri && !useNativeWindowChrome && (
        <div data-tauri-drag-region className="absolute inset-0 z-0" />
      )}
      {/* Left: app identity */}
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
        <div
          className={cn(
            "relative z-10 min-w-0 flex-1 self-stretch pt-2",
            isSplitTabs
              ? "grid grid-cols-2 items-end"
              : "flex items-end",
          )}
          style={
            isSplitTabs
              ? {
                  gridTemplateColumns: `${splitRatio}fr ${1 - splitRatio}fr`,
                }
              : undefined
          }
        >
          {isSplitTabs && (
            <div
              className="pointer-events-none absolute inset-y-2 z-10 w-px -translate-x-1/2 bg-border/50"
              style={{ left: `${splitRatio * 100}%` }}
            />
          )}
          {editorGroups.groups.map((group, groupIndex) => {
            const hasDraftTab = group.tabs.some((t) => t.kind === "draft")
            const visibleTabs = group.tabs
            if (visibleTabs.length === 0) return null
            const isFocusedGroup = group.id === editorGroups.focusedGroupId
            const isLastGroup = groupIndex === editorGroups.groups.length - 1
            return (
              <div
                key={group.id}
                className="flex min-w-0 flex-1 items-end rounded-t-md"
                style={
                  isLastGroup && rightClusterWidth > 0
                    ? { paddingRight: rightClusterWidth + 12 }
                    : undefined
                }
                onDragOver={(event) => {
                  if (!onMoveChatTab) return
                  const tabId = event.dataTransfer.types.includes("text/tab-id")
                  if (!tabId) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  setDragOverGroupId(group.id)
                }}
                onDragLeave={() => {
                  if (dragOverGroupId === group.id) setDragOverGroupId(null)
                }}
                onDrop={(event) => {
                  if (!onMoveChatTab) return
                  event.preventDefault()
                  const tabId = event.dataTransfer.getData("text/tab-id")
                  const sourceGroupId = event.dataTransfer.getData("text/source-group") as "group-1" | "group-2"
                  setDragOverGroupId(null)
                  setDragOverTabId(null)
                  setDraggingTabId(null)
                  if (!tabId || !sourceGroupId || sourceGroupId === group.id) return
                  onMoveChatTab(tabId, sourceGroupId, group.id)
                }}
              >
                <div
                  onWheel={(event) => {
                    const target = event.currentTarget
                    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                      target.scrollLeft += event.deltaY
                    }
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden scroll-smooth scrollbar-hide",
                    isSplitTabs
                      ? groupIndex === 0
                        ? "pl-0 pr-2"
                        : "pl-0 pr-1"
                      : "px-0",
                  )}
                >
                  {visibleTabs.map((tab, tabIndex) => (
                    <motion.div
                      key={tab.id}
                      layout="position"
                      transition={{ layout: { type: "tween", duration: 0.16, ease: [0.2, 0, 0, 1] } }}
                      className="shrink-0"
                      style={{ position: "relative", zIndex: draggingTabId === tab.id ? 60 : group.activeTabId === tab.id ? 30 : 10 }}
                    >
                      <HeaderTab
                        tab={tab}
                        isActive={group.activeTabId === tab.id}
                        isFocusedGroup={isFocusedGroup}
                        isDragging={draggingTabId === tab.id}
                        isDragTarget={dragOverTabId === tab.id}
                        onSelect={() => onSelectChatTab?.(group.id, tab.id)}
                        onClose={() => onCloseChatTab?.(tab.id)}
                        onOpenWindow={
                          tab.kind === "chat"
                            ? () => onOpenChatTabWindow?.(tab)
                            : undefined
                        }
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/tab-id", tab.id)
                          event.dataTransfer.setData("text/source-group", group.id)
                          event.dataTransfer.effectAllowed = "move"
                          setDraggingTabId(tab.id)
                        }}
                        onDragOver={(event) => {
                          if (!onMoveChatTab) return
                          if (!event.dataTransfer.types.includes("text/tab-id")) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = "move"
                          setDragOverGroupId(group.id)
                          setDragOverTabId(tab.id)
                        }}
                        onDrop={(event) => {
                          if (!onMoveChatTab) return
                          event.preventDefault()
                          event.stopPropagation()
                          const tabId = event.dataTransfer.getData("text/tab-id")
                          const sourceGroupId = event.dataTransfer.getData("text/source-group") as "group-1" | "group-2"
                          setDraggingTabId(null)
                          setDragOverGroupId(null)
                          setDragOverTabId(null)
                          if (!tabId || !sourceGroupId || tabId === tab.id) return

                          const rect = event.currentTarget.getBoundingClientRect()
                          const droppedAfterTarget = event.clientX > rect.left + rect.width / 2
                          const rawTargetIndex = tabIndex + (droppedAfterTarget ? 1 : 0)
                          const sourceIndex = sourceGroupId === group.id
                            ? visibleTabs.findIndex((item) => item.id === tabId)
                            : -1
                          const targetIndex = sourceIndex >= 0 && sourceIndex < rawTargetIndex
                            ? rawTargetIndex - 1
                            : rawTargetIndex

                          onMoveChatTab(tabId, sourceGroupId, group.id, targetIndex)
                        }}
                        onDragEnd={() => {
                          setDraggingTabId(null)
                          setDragOverGroupId(null)
                          setDragOverTabId(null)
                        }}
                      />
                    </motion.div>
                  ))}
                  {onNewChat && !hasDraftTab && (
                    <button
                      type="button"
                      aria-label="New chat"
                      title="New chat"
                      onClick={(event) => {
                        event.stopPropagation()
                        onNewChat(group.id)
                      }}
                      className="mb-[8px] ml-1.5 mr-3 flex h-6 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground/38 transition-colors hover:bg-white/[0.055] hover:text-foreground/72 dark:text-white/40 dark:hover:bg-white/[0.06] dark:hover:text-white/76"
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
      <div ref={rightClusterRef} className={cn("absolute right-0 top-0 z-20 flex h-full items-center gap-0 bg-[#151515] pl-2", showWindowControls ? "pr-0" : "pr-3")}>
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

            <HeaderActionTooltip
              label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              <button
                type="button"
                data-testid="toggle-sidebar"
                aria-label={
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
            </HeaderActionTooltip>

            <HeaderActionTooltip label="Toggle inspector panel">
              <button
                type="button"
                aria-label="Toggle inspector panel"
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
            </HeaderActionTooltip>

            <HeaderActionTooltip label="Toggle terminal">
              <button
                type="button"
                aria-label="Toggle terminal"
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
            </HeaderActionTooltip>

            <HeaderActionTooltip label="Open logs">
              <button
                type="button"
                aria-label="Open logs"
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
            </HeaderActionTooltip>

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
    <HeaderActionTooltip label={label}>
      <button
        type="button"
        aria-label={label}
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
    </HeaderActionTooltip>
  )
}

function HeaderActionTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        showArrow={false}
        className={cn(
          GLASS_POPOVER,
          "max-w-[420px] whitespace-normal break-words border-transparent bg-[var(--glass-bg)] px-3 py-1.5 text-[12px] font-medium text-foreground",
          "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),0_10px_30px_rgba(0,0,0,0.32)]",
        )}
      >
        <span className="block whitespace-normal break-words">{label}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function HeaderTab({
  tab,
  isActive,
  isFocusedGroup = true,
  isDragging = false,
  isDragTarget = false,
  onSelect,
  onClose,
  onOpenWindow,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  tab: EditorTab
  isActive: boolean
  isFocusedGroup?: boolean
  isDragging?: boolean
  isDragTarget?: boolean
  onSelect: () => void
  onClose: () => void
  onOpenWindow?: () => void
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
}) {
  const activeAndFocused = isActive && isFocusedGroup
  const tabLabel = `${tab.subtitle} / ${tab.title}`
  const openTabWindow = () => {
    if (onOpenWindow) {
      onOpenWindow()
      return
    }
    if (tab.kind === "chat" && tab.chat?.id) {
      void openRouteInNewWindow(`/${tab.chat.id}`, tab.title)
    }
  }
  const tabButton = (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onDoubleClick={(event) => {
        if (tab.kind !== "chat") return
        event.preventDefault()
        event.stopPropagation()
        openTabWindow()
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group relative mb-0 flex h-[35px] w-46 shrink-0 cursor-grab items-center gap-2 overflow-hidden rounded-t-[10px] border border-b-0 px-3 text-left transition-[background-color,border-color,box-shadow,opacity,transform] duration-200 active:cursor-grabbing",
        isDragging && "opacity-45",
        isDragTarget && !isDragging && "-translate-y-px ring-1 ring-inset ring-white/15",
        activeAndFocused
          ? "z-20 overflow-visible border-transparent bg-background text-foreground shadow-none before:pointer-events-none before:absolute before:bottom-0 before:-left-[10px] before:size-[10px] before:rounded-br-[10px] before:shadow-[4px_4px_0_4px_var(--background)] after:pointer-events-none after:absolute after:bottom-0 after:-right-[10px] after:size-[10px] after:rounded-bl-[10px] after:shadow-[-4px_4px_0_4px_var(--background)]"
          : isActive
            ? "z-10 overflow-visible border-transparent bg-background/72 text-foreground/74 shadow-none before:pointer-events-none before:absolute before:bottom-0 before:-left-[10px] before:size-[10px] before:rounded-br-[10px] before:shadow-[4px_4px_0_4px_var(--background)] after:pointer-events-none after:absolute after:bottom-0 after:-right-[10px] after:size-[10px] after:rounded-bl-[10px] after:shadow-[-4px_4px_0_4px_var(--background)]"
            : "border-transparent bg-transparent text-foreground/56 hover:bg-white/[0.045] hover:text-foreground/78 dark:border-transparent dark:bg-transparent dark:text-white/58 dark:hover:bg-white/[0.055] dark:hover:text-white/80",
      )}
    >
      <div
        className={cn(
          "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full",
          isActive
            ? "bg-foreground/[0.055] text-foreground/58 dark:bg-white/[0.055] dark:text-white/62"
            : "bg-transparent text-foreground/34 dark:text-white/38",
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
      <div className="relative z-10 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span
            className={cn(
              "truncate text-[10.5px]",
              isActive
                ? "text-foreground/34 dark:text-white/36"
                : "text-foreground/24 dark:text-white/26",
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
                ? "text-foreground/88 dark:text-white/90"
                : isActive
                  ? "text-foreground/68 dark:text-white/70"
                  : "text-foreground/62 dark:text-white/64",
            )}
          >
            {tab.title}
          </span>
        </div>
      </div>
      {tab.kind === "chat" && (
        <div
          className={cn(
            "relative z-10 ml-0.5 flex shrink-0 items-center gap-0.5 transition-opacity group-hover:opacity-100",
            isActive ? "opacity-100" : "opacity-0",
          )}
        >
          <span
            role="button"
            tabIndex={0}
            aria-label="Open as new window"
            title="Open as new window"
            onClick={(e) => {
              e.stopPropagation()
              openTabWindow()
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                openTabWindow()
              }
            }}
            className={cn(
              "flex size-5 cursor-pointer items-center justify-center rounded-md transition-colors",
              isActive
                ? "text-foreground/36 hover:bg-foreground/[0.06] hover:text-foreground/72 dark:text-white/36 dark:hover:bg-white/[0.06] dark:hover:text-white/72"
                : "text-foreground/28 hover:bg-foreground/[0.05] hover:text-foreground/58 dark:text-white/28 dark:hover:bg-white/[0.05] dark:hover:text-white/58",
            )}
          >
            <LuExternalLink className="size-3.5" />
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Close tab"
            title="Close tab"
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
              "flex size-5 cursor-pointer items-center justify-center rounded-md transition-colors",
              isActive
                ? "text-foreground/36 hover:bg-foreground/[0.06] hover:text-foreground/72 dark:text-white/36 dark:hover:bg-white/[0.06] dark:hover:text-white/72"
                : "text-foreground/28 hover:bg-foreground/[0.05] hover:text-foreground/58 dark:text-white/28 dark:hover:bg-white/[0.05] dark:hover:text-white/58",
            )}
          >
            <VscClose className="size-3.5" />
          </span>
        </div>
      )}
      {tab.kind !== "chat" && (
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
            "cursor-pointer relative z-10 ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors group-hover:opacity-100",
            isActive ? "opacity-100" : "opacity-0",
            isActive
              ? "text-foreground/36 hover:bg-foreground/[0.06] hover:text-foreground/72 dark:text-white/36 dark:hover:bg-white/[0.06] dark:hover:text-white/72"
              : "text-foreground/28 hover:bg-foreground/[0.05] hover:text-foreground/58 dark:text-white/28 dark:hover:bg-white/[0.05] dark:hover:text-white/58",
          )}
        >
          <VscClose className="size-3.5" />
        </span>
      )}
    </div>
  )

  return (
    <HeaderTooltip label={tabLabel}>
      {tabButton}
    </HeaderTooltip>
  )
}

function HeaderTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div className="shrink-0">{children}</div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        showArrow={false}
        className={cn(
          "max-w-[min(420px,calc(100vw-24px))] rounded-md border border-white/[0.08] bg-[#1B1B1D]/88 px-2.5 py-1 text-[12px] font-medium text-foreground backdrop-blur-xl",
          "shadow-[0_8px_24px_rgba(0,0,0,0.28)]",
        )}
      >
        <span className="block break-words whitespace-normal">{label}</span>
      </TooltipContent>
    </Tooltip>
  )
}
