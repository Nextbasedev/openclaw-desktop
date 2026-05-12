"use client"

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { usePlatform } from "@/hooks/usePlatform"
import type { HeaderUser } from "@/components/settings/settings.config"
import { NotificationPopover } from "@/components/notifications/NotificationPopover"
import { invoke } from "@/lib/ipc"
import { openRouteInNewWindow } from "@/lib/openRouteWindow"
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
  onOpenChatTabWindow?: (tab: EditorTab) => void
  onMoveChatTab?: (
    tabId: string,
    sourceGroupId: "group-1" | "group-2",
    targetGroupId: "group-1" | "group-2",
  ) => void
  onNewChat?: (groupId?: "group-1" | "group-2") => void
  showSplitButton?: boolean
  splitActive?: boolean
  splitRatio?: number
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
  onNavigateToChat,
}: HeaderProps) {
  const platform = usePlatform()
  const [isTauri, setIsTauri] = useState(false)
  const [openClawVersion, setOpenClawVersion] = useState<string | null>(null)
  const [nodeVersion, setNodeVersion] = useState<string | null>(null)
  const rightClusterRef = useRef<HTMLDivElement>(null)
  const [rightClusterWidth, setRightClusterWidth] = useState(0)
  const [dragOverGroupId, setDragOverGroupId] = useState<"group-1" | "group-2" | null>(null)

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

  const hasVisibleTabs = Boolean(editorGroups?.groups.some((g) => g.tabs.length > 0))
  const isSplitTabs = (editorGroups?.groups.length ?? 0) > 1

  return (
    <header
      className={cn(
        "relative z-50 flex h-11 shrink-0 items-center",
        "bg-[#151515]",
        "select-none",
        className,
      )}
    >
      {isTauri && (
        <div data-tauri-drag-region className="absolute inset-0 z-0" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-px bg-border/50" />

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
                className={cn(
                  "flex min-w-0 flex-1 items-end rounded-t-md transition-colors",
                  dragOverGroupId === group.id && "bg-white/[0.035] ring-1 ring-inset ring-white/10",
                )}
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
                  {visibleTabs.map((tab) => (
                    <HeaderTab
                      key={tab.id}
                      tab={tab}
                      isActive={group.activeTabId === tab.id}
                      isFocusedGroup={isFocusedGroup}
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
                      }}
                      onDragEnd={() => setDragOverGroupId(null)}
                    />
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
  onOpenWindow,
  onDragStart,
  onDragEnd,
}: {
  tab: EditorTab
  isActive: boolean
  isFocusedGroup?: boolean
  onSelect: () => void
  onClose: () => void
  onOpenWindow?: () => void
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
}) {
  const activeAndFocused = isActive && isFocusedGroup
  const tabLabel = `${tab.subtitle} / ${tab.title}`
  const [menuOpen, setMenuOpen] = useState(false)
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
      onDragEnd={onDragEnd}
      onDoubleClick={(event) => {
        if (tab.kind !== "chat") return
        event.preventDefault()
        event.stopPropagation()
        openTabWindow()
      }}
      onContextMenu={(event) => {
        if (tab.kind !== "chat") return
        event.preventDefault()
        event.stopPropagation()
        setMenuOpen(true)
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group relative mb-0 flex h-[35px] w-46 shrink-0 items-center gap-2 overflow-hidden rounded-t-[10px] border border-b-0 px-3 text-left transition-[background-color,border-color,box-shadow,opacity] duration-200",
        activeAndFocused
          ? "z-20 border-white/10 bg-background text-foreground shadow-[0_1px_0_0_var(--background),0_-6px_16px_rgba(0,0,0,0.2)]"
          : isActive
            ? "z-10 border-white/8 bg-background/72 text-foreground/74 shadow-[0_1px_0_0_var(--background)]"
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
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <span
              role="button"
              tabIndex={0}
              aria-label="Open tab menu"
              title="Tab options"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((open) => !open)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenuOpen((open) => !open)
                }
              }}
              className={cn(
                "relative z-10 ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors group-hover:opacity-100",
                isActive || menuOpen ? "opacity-100" : "opacity-0",
                isActive
                  ? "text-foreground/36 hover:bg-foreground/[0.06] hover:text-foreground/72 dark:text-white/36 dark:hover:bg-white/[0.06] dark:hover:text-white/72"
                  : "text-foreground/28 hover:bg-foreground/[0.05] hover:text-foreground/58 dark:text-white/28 dark:hover:bg-white/[0.05] dark:hover:text-white/58",
              )}
            >
              <Icons.MoreVertical size={14} strokeWidth={1.5} />
            </span>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={6}
            className="z-[9999] w-44 gap-0 rounded-xl border border-white/[0.08] bg-[#1B1B1D]/95 p-1 shadow-2xl backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen(false)
                openTabWindow()
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/8 hover:text-foreground"
            >
              <LuExternalLink className="size-3.5" />
              Open as new window
            </button>
            <div className="my-0.5 h-px bg-border/20" />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen(false)
                onClose()
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/8 hover:text-foreground"
            >
              <VscClose className="size-3.5" />
              Close tab
            </button>
          </PopoverContent>
        </Popover>
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
            "relative z-10 ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors group-hover:opacity-100",
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
  const [show, setShow] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  function handleEnter() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    })
    setShow(true)
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
      className="shrink-0"
    >
      {children}
      {show && mounted && createPortal(
        <div
          className="pointer-events-none fixed z-[9999]"
          style={{
            top: pos.top,
            left: pos.left,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div
            className={cn(
              "whitespace-nowrap rounded-[12px] px-2.5 py-1",
              "border border-white/[0.08] bg-[#1B1B1D]/88 backdrop-blur-xl",
              "text-[12px] font-medium text-foreground",
              "shadow-[0_8px_24px_rgba(0,0,0,0.28)]",
            )}
          >
            {label}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
