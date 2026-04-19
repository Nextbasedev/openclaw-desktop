import { useState, useCallback, useMemo, useEffect } from "react"
import { Reorder } from "framer-motion"
import { VersionUpdateModal } from "./VersionUpdateModal"
import { ProjectsSection, type ActiveTopic } from "./ProjectsSection"
import { ChatsSection, type ActiveChat } from "./ChatsSection"
import { cn } from "@/lib/utils"
import { SidebarItem, GlassTooltip, type SidebarNavItem } from "./SidebarItem"
import { ModelSelector } from "./ModelSelector"
import { Icons } from "../icons"

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
  const [versionModalOpen, setVersionModalOpen] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const handleReorder = useCallback((newOrder: string[]) => {
    if (collapsed) return
    const reordered = newOrder
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean) as SidebarNavItem[]
    onItemsChange(reordered)
  }, [collapsed, items, onItemsChange])

  const sidebarStyle = useMemo(() => ({ width: `${width}px` }), [width])
  const itemIds = useMemo(() => items.map((i) => i.id), [items])

  return (
    <aside
      style={sidebarStyle}
      className={cn(
        "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
        "border-r border-border/50 bg-card/70 backdrop-blur-xl",
        "shadow-none transition-[width,background-color] duration-200 ease-out",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] opacity-60 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]" />

      <nav className={cn("relative z-10 flex-1 px-2 py-3", collapsed ? "overflow-hidden" : "overflow-y-auto scroll-smooth overscroll-contain")}>
        {mounted && !collapsed ? (
          <Reorder.Group axis="y" values={itemIds} onReorder={handleReorder} as="div" className="flex flex-col gap-1">
            {items.map((item) => (
              <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} collapsed={collapsed} draggable />
            ))}
          </Reorder.Group>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} collapsed={collapsed} />
            ))}
          </div>
        )}

        {!collapsed && (
          <div className="mt-3 border-t border-border/10 pt-3">
            <ChatsSection collapsed={collapsed} activeChat={activeChat} onChatSelect={onChatSelect} onChatClear={onChatClear} onNewChat={onNewChat} refreshTrigger={chatRefreshTrigger} />
          </div>
        )}
        {collapsed && (
          <div className="mt-3 border-t border-border/10 pt-1">
            <GlassTooltip label="Chats">
              <button
                type="button"
                onClick={onNewChat}
                className="flex w-full min-w-0 cursor-pointer items-center justify-center rounded-md px-0 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                <Icons.BubbleChat size={16} strokeWidth={1.5} className="shrink-0" />
              </button>
            </GlassTooltip>
          </div>
        )}

        {!collapsed && (
          <div className="mt-3 border-t border-border/10 pt-3">
            <ProjectsSection collapsed={collapsed} activeTopic={activeTopic} onTopicSelect={onTopicSelect} onTopicClear={onTopicClear} />
          </div>
        )}
        {collapsed && (
          <div className="mt-3 border-t border-border/10 pt-1">
            <GlassTooltip label="Projects">
              <button
                type="button"
                onClick={() => onTabChange("project")}
                className="flex w-full min-w-0 cursor-pointer items-center justify-center rounded-md px-0 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                <Icons.Files size={16} strokeWidth={1.5} className="shrink-0" />
              </button>
            </GlassTooltip>
          </div>
        )}
      </nav>

      {!collapsed && (
        <div className="relative z-10 border-t border-border/10 px-2 py-2">
          <ModelSelector />
        </div>
      )}

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

      <VersionUpdateModal open={versionModalOpen} onOpenChange={setVersionModalOpen} />
    </aside>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
