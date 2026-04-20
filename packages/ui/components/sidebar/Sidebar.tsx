import { useState, useCallback, useMemo, useEffect, useRef } from "react"
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

type SidebarProps = {
  className?: string
  width?: number
  collapsed?: boolean
  onResizeStart?: () => void
  activeTab: string
  onTabChange: (tab: string) => void
  items: SidebarNavItem[]
  onItemsChange: (items: SidebarNavItem[]) => void
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
  onResizeStart,
  activeTab,
  onTabChange,
  items,
  onItemsChange,
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
  const [chatsPopoverOpen, setChatsPopoverOpen] = useState(false)
  const [projectsPopoverOpen, setProjectsPopoverOpen] = useState(false)
  const prevCollapsed = useRef(collapsed)

  useEffect(() => { setMounted(true) }, [])

  if (prevCollapsed.current !== collapsed) {
    prevCollapsed.current = collapsed
    if (!collapsed) {
      if (chatsPopoverOpen) setChatsPopoverOpen(false)
      if (projectsPopoverOpen) setProjectsPopoverOpen(false)
    }
  }

  const handleReorder = useCallback((newOrder: string[]) => {
    if (collapsed) return
    const reordered = newOrder
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean) as SidebarNavItem[]
    onItemsChange(reordered)
  }, [collapsed, items, onItemsChange])

  const sidebarStyle = useMemo(() => ({ width: `${width}px` }), [width])
  const itemIds = useMemo(() => items.map((i) => i.id), [items])

  const handleChatSelectInPopover = useCallback((chat: ActiveChat) => {
    setChatsPopoverOpen(false)
    onChatSelect(chat)
  }, [onChatSelect])

  const handleTopicSelectInPopover = useCallback((topic: ActiveTopic) => {
    setProjectsPopoverOpen(false)
    onTopicSelect(topic)
  }, [onTopicSelect])

  return (
    <aside
      style={sidebarStyle}
      className={cn(
        "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
        "border-r border-border/50 bg-card/70 backdrop-blur-xl",
        "shadow-none transition-[width] duration-200 ease-out",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] opacity-60 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]" />

      <nav className={cn(
        "relative z-10 flex-1 py-3",
        "px-2",
        collapsed ? "overflow-hidden" : "overflow-y-auto scroll-smooth overscroll-contain",
      )}>
        {mounted && !collapsed ? (
          <Reorder.Group axis="y" values={itemIds} onReorder={handleReorder} as="div" className="flex flex-col gap-0.5">
            {items.map((item) => (
              <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} collapsed={collapsed} draggable />
            ))}
          </Reorder.Group>
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} collapsed={collapsed} />
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
                    activeTopic={activeTopic}
                    onTopicSelect={handleTopicSelectInPopover}
                    onTopicClear={onTopicClear}
                  />
                </div>
              </PopoverContent>
            </Popover>

          </div>
        )}

        <div className={cn("mt-2 border-t border-border/10 pt-2", collapsed && "hidden")}>
          <ChatsSection
            collapsed={false}
            activeChat={activeChat}
            onChatSelect={onChatSelect}
            onChatClear={onChatClear}
            onNewChat={onNewChat}
            refreshTrigger={chatRefreshTrigger}
          />
        </div>

        <div className={cn("mt-2 border-t border-border/10 pt-2", collapsed && "hidden")}>
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
          )}
        />
      )}
    </aside>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
