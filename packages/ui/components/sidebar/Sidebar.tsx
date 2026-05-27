import { useState, useCallback, useMemo, useEffect, type CSSProperties } from "react"
import { Reorder } from "framer-motion"
import type { ActiveTopic } from "@/types/project"
import { ChatsSection, type ActiveChat } from "./ChatsSection"
import { CollapsedSpacesPopover } from "./CollapsedSpacesPopover"
import { cn } from "@/lib/utils"
import { SidebarItem, type SidebarNavItem } from "./SidebarItem"
import type { Space } from "@/types/space"

const DEFAULT_DRAGGABLE_ITEMS: SidebarNavItem[] = []

const NAV_HREFS: Record<string, string> = {}

const UNIQUE_SIDEBAR_BG_KEY = "openclaw.uniqueSidebarBg"

type SidebarProps = {
  className?: string
  width?: number
  collapsed?: boolean
  onClose?: () => void
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
  onSpaceCreate: (name?: string) => void | Promise<void>
  onSpaceUpdate: (spaceId: string, input: { name?: string; repoRoot?: string | null }) => unknown | Promise<unknown>
  onSpaceArchive: (spaceId: string) => void | Promise<void>
  onSpaceDelete: (spaceId: string) => void | Promise<void>
}

export function Sidebar({
  className,
  width = 220,
  collapsed = false,
  onClose,
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
    [width],
  )
  const handlePrimaryTabClick = useCallback((tab: string) => {
    onTabChange(tab)
    if (isMobileViewport) onClose?.()
  }, [isMobileViewport, onClose, onTabChange])

  const isHiddenMobileSidebar = collapsed && isMobileViewport
  const showExpandedContent = !collapsed || isMobileViewport
  const itemCollapsed = isMobileViewport ? false : collapsed
  const showPrimaryNav = items.length > 0
  const activeSpaceName =
    spaces.find((space) => space.id === activeSpaceId)?.name ?? "MySpace"

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/30 transition-opacity duration-200 md:hidden",
          collapsed
            ? "pointer-events-none opacity-0"
            : "opacity-100",
        )}
      />

      <aside
        aria-hidden={isHiddenMobileSidebar}
        style={sidebarStyle}
        className={cn(
          "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
          "w-[var(--sidebar-width)]",
          "z-40",
          "border-r border-border/50",
          uniqueSidebarBg
            ? "bg-gradient-to-b from-[#F4F7FF] to-[#E6EEFE] dark:from-[#0D1424] dark:to-[#060913]"
            : "bg-white dark:bg-[#151518]",
          "shadow-none transition-[width,transform,opacity] duration-200 ease-out",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:h-svh max-md:w-[var(--sidebar-mobile-width)] max-md:shadow-xl",
          collapsed
            ? "max-md:-translate-x-full max-md:opacity-0 max-md:pointer-events-none"
            : "max-md:translate-x-0 max-md:opacity-100",
          className,
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]",
            uniqueSidebarBg ? "opacity-0" : "opacity-60",
          )}
        />

        <nav className={cn(
          "relative z-10 flex-1 py-3",
          showExpandedContent ? "flex min-h-0 overflow-hidden" : "overflow-hidden px-2",
          isHiddenMobileSidebar && "hidden",
        )}>
          {showExpandedContent ? (
            <>
              <div className="flex w-[54px] shrink-0 flex-col items-center overflow-y-auto px-2 pb-2 scrollbar-hide">
                <CollapsedSpacesPopover
                  spaces={spaces}
                  activeSpaceId={activeSpaceId}
                  onSpaceSwitch={onSpaceSwitch}
                  onSpaceNewChat={onSpaceNewChat}
                  onSpaceCreate={onSpaceCreate}
                  onSpaceUpdate={onSpaceUpdate}
                  onSpaceArchive={onSpaceArchive}
                  onSpaceDelete={onSpaceDelete}
                />
              </div>

              <div className="min-w-0 flex-1 overflow-y-auto px-2 scroll-smooth overscroll-contain">
                {showPrimaryNav && mounted && (
                  <Reorder.Group
                    axis="y"
                    values={items.map((i) => i.id)}
                    onReorder={onItemsReorder}
                    as="div"
                    className="flex flex-col gap-0.5"
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

                <div className={cn(showPrimaryNav && "mt-2 border-t border-border/10 pt-2")}>
                  <ChatsSection
                    collapsed={false}
                    sectionLabel={activeSpaceName}
                    activeChat={activeChat}
                    onChatSelect={onChatSelect}
                    onChatClear={onChatClear}
                    onNewChat={onNewChat}
                    refreshTrigger={chatRefreshTrigger}
                    spaceId={activeSpaceId}
                  />
                </div>
              </div>
            </>
          ) : !showExpandedContent ? (
            <div className="flex flex-col items-center gap-3 pt-1">
              <CollapsedSpacesPopover
                spaces={spaces}
                activeSpaceId={activeSpaceId}
                onSpaceSwitch={onSpaceSwitch}
                onSpaceNewChat={onSpaceNewChat}
                onSpaceCreate={onSpaceCreate}
                onSpaceUpdate={onSpaceUpdate}
                onSpaceArchive={onSpaceArchive}
                onSpaceDelete={onSpaceDelete}
              />
            </div>
          ) : null}

        </nav>

        {!collapsed && (
          <button
            type="button"
            aria-label="Resize sidebar"
            onMouseDown={onResizeStart}
            className={cn(
              "absolute right-0 top-0 z-20 h-full w-1 -translate-x-1/2 cursor-col-resize",
              "bg-transparent transition-colors duration-150",
              "max-md:hidden",
            )}
          />
        )}
      </aside>
    </>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
