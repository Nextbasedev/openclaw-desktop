import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  type CSSProperties,
} from "react"
import { Reorder } from "framer-motion"
import type { ActiveTopic } from "@/types/project"
import { ChatsSection, type ActiveChat } from "./ChatsSection"
import { CollapsedSpacesPopover } from "./CollapsedSpacesPopover"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { SidebarItem, type SidebarNavItem } from "./SidebarItem"
import type { Space } from "@/types/space"

const DEFAULT_DRAGGABLE_ITEMS: SidebarNavItem[] = [
  { id: "chat", label: "Chats", icon: "chat" },
  { id: "skill", label: "Skills", icon: "skill" },
  { id: "connect", label: "Connect", icon: "connect" },
]

const NAV_HREFS: Record<string, string> = {}

const UNIQUE_SIDEBAR_BG_KEY = "openclaw.uniqueSidebarBg"

type SidebarProps = {
  className?: string
  width?: number
  collapsed?: boolean
  previewExpanded?: boolean
  previewSpaceId?: string | null
  onClose?: () => void
  onPreviewOpen?: (spaceId: string) => void
  onPreviewClose?: () => void
  onResizeStart?: () => void
  activeTab: string
  onTabChange: (tab: string) => void
  items: SidebarNavItem[]
  onItemsReorder: (ids: string[]) => void
  activeTopic: ActiveTopic | null
  onTopicSelect: (topic: ActiveTopic) => void
  onTopicClear: () => void
  activeChat: ActiveChat | null
  onChatSelect: (chat: ActiveChat) => void
  onChatClear: (chatId?: string) => void
  onNewChat: () => void
  chatRefreshTrigger?: number
  spaces: Space[]
  activeSpaceId: string | null
  onSpaceSwitch: (spaceId: string) => void | Promise<void>
  onSpaceNewChat: (spaceId: string) => void | Promise<void>
  onSpaceCreate: (name?: string, iconImage?: SpaceIconImage | null, iconEmoji?: SpaceIconEmoji | null) => void | Promise<void>
  onSpaceUpdate: (
    spaceId: string,
    input: { name?: string; iconEmoji?: SpaceIconEmoji | null; repoRoot?: string | null }
  ) => unknown | Promise<unknown>
  onSpaceArchive: (spaceId: string) => void | Promise<void>
  onSpaceDelete: (spaceId: string) => void | Promise<void>
}

type SpaceIconImage = NonNullable<Space["iconImage"]>
type SpaceIconEmoji = NonNullable<Space["iconEmoji"]>

export function Sidebar({
  className,
  width = 220,
  collapsed = false,
  previewExpanded = false,
  previewSpaceId = null,
  onClose,
  onPreviewOpen,
  onPreviewClose,
  onResizeStart,
  activeTab,
  onTabChange,
  items,
  onItemsReorder,
  activeChat,
  onChatSelect,
  onChatClear,
  onNewChat,
  chatRefreshTrigger = 0,
  spaces,
  activeSpaceId,
  onSpaceSwitch,
  onSpaceNewChat,
  onSpaceCreate,
  onSpaceUpdate,
  onSpaceArchive,
  onSpaceDelete,
}: SidebarProps) {
  const [mounted, setMounted] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [uniqueSidebarBg, setUniqueSidebarBg] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(UNIQUE_SIDEBAR_BG_KEY) === "true"
  })

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    function syncViewport() {
      setIsMobileViewport(window.innerWidth < 768)
    }

    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [])

  useEffect(() => {
    function syncSidebarBackground(event?: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "boolean") {
        setUniqueSidebarBg(event.detail)
        return
      }
      setUniqueSidebarBg(localStorage.getItem(UNIQUE_SIDEBAR_BG_KEY) === "true")
    }

    window.addEventListener("appearance:sidebar-bg", syncSidebarBackground)
    window.addEventListener("storage", syncSidebarBackground)
    return () => {
      window.removeEventListener("appearance:sidebar-bg", syncSidebarBackground)
      window.removeEventListener("storage", syncSidebarBackground)
    }
  }, [])

  const sidebarStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${width}px`,
        "--sidebar-mobile-width": `${Math.min(width, 320)}px`,
      }) as CSSProperties,
    [width]
  )
  const handlePrimaryTabClick = useCallback(
    (tab: string) => {
      onTabChange(tab)
      if (isMobileViewport) onClose?.()
    },
    [isMobileViewport, onClose, onTabChange]
  )

  const isHiddenMobileSidebar = collapsed && isMobileViewport
  const showExpandedContent = !collapsed || previewExpanded || isMobileViewport
  const itemCollapsed = isMobileViewport ? false : collapsed && !previewExpanded
  const showPrimaryNav = items.length > 0
  const effectiveSpaceId = previewExpanded && previewSpaceId ? previewSpaceId : activeSpaceId
  const activeSpaceName =
    spaces.find((space) => space.id === effectiveSpaceId)?.name ?? "MySpace"
  const activeSpace = spaces.find((space) => space.id === effectiveSpaceId) ?? null

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/30 transition-opacity duration-200 md:hidden",
          collapsed ? "pointer-events-none opacity-0" : "opacity-100"
        )}
      />

      <aside
        aria-hidden={isHiddenMobileSidebar}
        style={sidebarStyle}
        onMouseLeave={previewExpanded ? onPreviewClose : undefined}
        className={cn(
          "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
          "w-[var(--sidebar-width)]",
          "z-40",
          "border-r border-border/50",
          uniqueSidebarBg
            ? "bg-gradient-to-b from-[#F4F7FF] to-[#E6EEFE] dark:from-[#0D1424] dark:to-[#060913]"
            : "bg-[linear-gradient(180deg,#F6F4EF_0%,#ECE8DF_100%)] dark:bg-[#151518]",
          "shadow-none transition-[width,transform,opacity] duration-[var(--panel-close-dur)] ease-[var(--panel-ease)] data-[open=true]:duration-[var(--panel-open-dur)]",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:h-svh max-md:w-[var(--sidebar-mobile-width)] max-md:shadow-xl",
          collapsed
            ? "max-md:pointer-events-none max-md:-translate-x-full max-md:opacity-0"
            : "max-md:translate-x-0 max-md:opacity-100",
          className
        )}
        data-open={showExpandedContent ? "true" : "false"}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]",
            uniqueSidebarBg ? "opacity-0" : "opacity-60"
          )}
        />

        <nav
          className={cn(
            "relative z-10 my-3 flex min-h-0 flex-1 overflow-hidden",
            isHiddenMobileSidebar && "hidden"
          )}
        >
          <div className={cn(
            "scrollbar-hide relative flex w-[62px] shrink-0 flex-col items-center overflow-y-auto px-2.5 pb-3 pt-1",
            "border-r border-black/[0.055] bg-[linear-gradient(180deg,rgba(24,24,27,0.055),rgba(24,24,27,0.025))] shadow-[inset_-1px_0_0_rgba(255,255,255,0.38)] dark:border-white/[0.055] dark:bg-black/[0.085] dark:shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)]",
          )}>
            <div className="mb-3 mt-0.5 flex h-6 w-9 items-center justify-center rounded-full border border-white/[0.045] bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]" aria-hidden="true">
              <span className="grid grid-cols-2 gap-0.5 opacity-45">
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
              </span>
            </div>
            <CollapsedSpacesPopover
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              tooltipsDisabled={previewExpanded}
              onCollapsedPreviewStart={collapsed && !isMobileViewport ? onPreviewOpen : undefined}
              onSpaceSwitch={onSpaceSwitch}
              onSpaceNewChat={onSpaceNewChat}
              onSpaceCreate={onSpaceCreate}
              onSpaceUpdate={onSpaceUpdate}
              onSpaceArchive={onSpaceArchive}
              onSpaceDelete={onSpaceDelete}
            />
          </div>

          <div
            className="t-panel-slide min-w-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth border-l border-black/[0.035] px-3 pb-3 shadow-[inset_12px_0_24px_-22px_rgba(0,0,0,0.18)] dark:border-white/[0.06] dark:shadow-[inset_12px_0_24px_-22px_rgba(0,0,0,0.55)]"
            data-open={showExpandedContent ? "true" : "false"}
            style={{ "--panel-translate-y": "18px" } as CSSProperties}
          >
            <div className="sticky top-0 z-20 -mx-3 mb-4 px-3 pb-2.5 pt-0.5 backdrop-blur-xl">
              <div className="group/workspace relative overflow-hidden rounded-2xl border border-black/[0.07] bg-[linear-gradient(135deg,rgba(255,255,255,0.78),rgba(255,255,255,0.38)_58%,rgba(8,145,178,0.10))] p-3 shadow-[0_16px_34px_rgba(24,24,27,0.10),inset_0_1px_0_rgba(255,255,255,0.78)] transition-transform duration-200 hover:-translate-y-px dark:border-white/[0.075] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.025)_58%,rgba(103,232,249,0.045))] dark:shadow-[0_18px_44px_rgba(0,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="pointer-events-none absolute -right-8 -top-10 size-24 rounded-full bg-cyan-400/20 blur-2xl dark:bg-cyan-300/10" />
                <div className="relative flex items-start gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.08] bg-zinc-950 text-white shadow-[0_8px_22px_rgba(24,24,27,0.24),inset_0_1px_0_rgba(255,255,255,0.12)] dark:border-white/[0.08] dark:bg-black/[0.18] dark:text-foreground">
                    <Icons.Project size={16} strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/68 dark:text-muted-foreground/78">
                      <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.65)] dark:bg-emerald-300 dark:shadow-[0_0_12px_rgba(110,231,183,0.75)]" />
                      Workspace
                    </div>
                    <div className="mt-1 truncate text-[14px] font-medium tracking-[-0.02em] text-foreground" title={activeSpaceName}>
                      {activeSpaceName}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-foreground/68 dark:text-muted-foreground/62">
                      {activeSpace?.repoRoot ? activeSpace.repoRoot : "Agent conversations"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onNewChat}
                  className="relative mt-2.5 flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-black/[0.08] bg-zinc-950 text-[12px] font-medium text-white shadow-[0_10px_22px_rgba(24,24,27,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] transition-[background,transform,border-color] duration-150 hover:-translate-y-px hover:border-cyan-500/30 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/25 dark:border-white/[0.08] dark:bg-white/[0.055] dark:text-foreground dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:border-cyan-200/20 dark:hover:bg-white/[0.085] dark:focus-visible:ring-cyan-300/25"
                >
                  <Icons.NewChat size={14} strokeWidth={1.6} />
                  New chat
                </button>
              </div>
            </div>

            {showPrimaryNav && mounted && (
              <Reorder.Group
                axis="y"
                values={items.map((i) => i.id)}
                onReorder={onItemsReorder}
                as="div"
                className="mb-4 flex flex-col gap-1 rounded-2xl border border-black/[0.055] bg-black/[0.035] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)] dark:border-white/[0.055] dark:bg-black/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                {items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    isActive={activeTab === item.id}
                    onClick={() => handlePrimaryTabClick(item.id)}
                    href={NAV_HREFS[item.id]}
                    collapsed={itemCollapsed}
                    draggable
                  />
                ))}
              </Reorder.Group>
            )}

            <div
              className={cn(
                showPrimaryNav && "border-t border-border/15 pt-3.5"
              )}
            >
              <ChatsSection
                collapsed={false}
                sectionLabel={activeSpaceName}
                activeChat={activeChat}
                onChatSelect={onChatSelect}
                onChatClear={onChatClear}
                onNewChat={onNewChat}
                refreshTrigger={chatRefreshTrigger}
                spaceId={effectiveSpaceId}
              />
            </div>
          </div>
        </nav>

        {!collapsed && (
          <button
            type="button"
            aria-label="Resize sidebar"
            onMouseDown={onResizeStart}
            className={cn(
              "absolute top-0 right-0 z-20 h-full w-1 -translate-x-1/2 cursor-col-resize",
              "bg-transparent transition-colors duration-150",
              "max-md:hidden"
            )}
          />
        )}
      </aside>
    </>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
