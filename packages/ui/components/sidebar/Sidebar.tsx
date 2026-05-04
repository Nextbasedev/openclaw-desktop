import { useState, useCallback, useMemo, useEffect, useRef, type CSSProperties } from "react"
import { Reorder } from "framer-motion"
import { ProjectsSection, type ActiveTopic } from "./ProjectsSection"
import { ChatsSection, type ActiveChat } from "./ChatsSection"
import { cn } from "@/lib/utils"
import { SidebarItem, GlassTooltip, type SidebarNavItem } from "./SidebarItem"
import { Icons } from "../icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { GLASS_POPOVER } from "@/constants/glassPopover"

const DEFAULT_DRAGGABLE_ITEMS: SidebarNavItem[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "skill", label: "Skill", icon: "skill" },
  { id: "connect", label: "Connect", icon: "connect" },
]

const NAV_HREFS: Record<string, string> = {
  chat: "/",
  skill: "/skill",
  connect: "/connect",
}

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
  onChatClear: () => void
  onNewChat: () => void
  chatRefreshTrigger?: number
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
  activeTopic,
  onTopicSelect,
  onTopicClear,
  activeChat,
  onChatSelect,
  onChatClear,
  onNewChat,
  chatRefreshTrigger = 0,
}: SidebarProps) {
  const [mounted, setMounted] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [uniqueSidebarBg, setUniqueSidebarBg] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(UNIQUE_SIDEBAR_BG_KEY) === "true"
  })
  const [chatsPopoverOpen, setChatsPopoverOpen] = useState(false)
  const [projectsPopoverOpen, setProjectsPopoverOpen] = useState(false)
  const prevCollapsed = useRef(collapsed)

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

  useEffect(() => {
    if (prevCollapsed.current === collapsed) return
    prevCollapsed.current = collapsed
    if (!collapsed) {
      const frame = window.requestAnimationFrame(() => {
        if (chatsPopoverOpen) setChatsPopoverOpen(false)
        if (projectsPopoverOpen) setProjectsPopoverOpen(false)
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [chatsPopoverOpen, collapsed, projectsPopoverOpen])

  const sidebarStyle = useMemo(
    () =>
      ({
        "--sidebar-width": `${width}px`,
        "--sidebar-mobile-width": `${Math.min(width, 320)}px`,
      }) as CSSProperties,
    [width],
  )
  const handleChatSelectInPopover = useCallback((chat: ActiveChat) => {
    setChatsPopoverOpen(false)
    onChatSelect(chat)
  }, [onChatSelect])

  const handleTopicSelectInPopover = useCallback((topic: ActiveTopic) => {
    setProjectsPopoverOpen(false)
    onTopicSelect(topic)
  }, [onTopicSelect])

  const handlePrimaryTabClick = useCallback((tab: string) => {
    onTabChange(tab)
    if (isMobileViewport) onClose?.()
  }, [isMobileViewport, onClose, onTabChange])

  const isHiddenMobileSidebar = collapsed && isMobileViewport
  const showExpandedContent = !collapsed || isMobileViewport
  const itemCollapsed = isMobileViewport ? false : collapsed

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
          "px-2",
          showExpandedContent ? "overflow-y-auto scroll-smooth overscroll-contain" : "overflow-hidden",
          isHiddenMobileSidebar && "hidden",
        )}>
          {mounted && showExpandedContent ? (
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
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item) => (
                <SidebarItem
                  key={item.id}
                  item={item}
                  isActive={activeTab === item.id}
                  onClick={() => handlePrimaryTabClick(item.id)}
                  href={NAV_HREFS[item.id]}
                  collapsed={itemCollapsed}
                />
              ))}

              <Popover open={chatsPopoverOpen} onOpenChange={setChatsPopoverOpen}>
                <PopoverTrigger asChild>
                  <div>
                    <GlassTooltip label="Chats" disabled={chatsPopoverOpen}>
                      <button
                        type="button"
                        className={cn(
                          "group flex w-full min-w-0 cursor-pointer items-center rounded-md px-2.5 py-2 text-left text-[13px] font-normal",
                          "transition-[background-color,color,opacity] duration-150 ease-in-out",
                          chatsPopoverOpen
                            ? "text-foreground"
                            : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
                        )}
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center">
                          <Icons.BubbleChat size={16} strokeWidth={1.5} />
                        </span>
                      </button>
                    </GlassTooltip>
                  </div>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="right"
                  sideOffset={8}
                  className={cn("w-[260px] p-0", GLASS_POPOVER)}
                >
                  <div className="max-h-[360px] overflow-y-auto p-2">
                    <ChatsSection
                      collapsed={false}
                      collapsible={false}
                      activeChat={activeChat}
                      onChatSelect={handleChatSelectInPopover}
                      onChatClear={onChatClear}
                      onNewChat={() => { setChatsPopoverOpen(false); onNewChat() }}
                      refreshTrigger={chatRefreshTrigger}
                    />
                  </div>
                </PopoverContent>
              </Popover>

              <Popover open={projectsPopoverOpen} onOpenChange={setProjectsPopoverOpen}>
                <PopoverTrigger asChild>
                  <div>
                    <GlassTooltip label="Projects" disabled={projectsPopoverOpen}>
                      <button
                        type="button"
                        className={cn(
                          "group flex w-full min-w-0 cursor-pointer items-center rounded-md px-2.5 py-2 text-left text-[13px] font-normal",
                          "transition-[background-color,color,opacity] duration-150 ease-in-out",
                          projectsPopoverOpen
                            ? "text-foreground"
                            : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
                        )}
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center">
                          <Icons.Files size={16} strokeWidth={1.5} />
                        </span>
                      </button>
                    </GlassTooltip>
                  </div>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="right"
                  sideOffset={8}
                  className={cn("w-[260px] p-0", GLASS_POPOVER)}
                >
                  <div className="max-h-[360px] overflow-y-auto p-2">
                    <ProjectsSection
                      collapsed={false}
                      collapsible={false}
                      activeTopic={activeTopic}
                      onTopicSelect={handleTopicSelectInPopover}
                      onTopicClear={onTopicClear}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <div className={cn("mt-2 border-t border-border/10 pt-2", !showExpandedContent && "hidden")}>
            <ChatsSection
              collapsed={false}
              activeChat={activeChat}
              onChatSelect={onChatSelect}
              onChatClear={onChatClear}
              onNewChat={onNewChat}
              refreshTrigger={chatRefreshTrigger}
            />
          </div>

          <div className={cn("mt-2 border-t border-border/10 pt-2", !showExpandedContent && "hidden")}>
            <ProjectsSection
              collapsed={false}
              activeTopic={activeTopic}
              onTopicSelect={onTopicSelect}
              onTopicClear={onTopicClear}
            />
          </div>

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
