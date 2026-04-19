import { useState, useCallback, useMemo, useEffect, useId } from "react"
import { VersionUpdateButton } from "./VersionUpdateButton"
import { VersionUpdateModal } from "./VersionUpdateModal"
import { ProjectsSection, type ActiveTopic } from "./ProjectsSection"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { cn } from "@/lib/utils"
import { SidebarItem, GlassTooltip, type SidebarNavItem } from "./SidebarItem"
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
}: SidebarProps) {
  const [mounted, setMounted] = useState(false)
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const id = useId()

  useEffect(() => { setMounted(true) }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (collapsed) return
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((i) => i.id === active.id)
      const newIndex = items.findIndex((i) => i.id === over.id)
      onItemsChange(arrayMove(items, oldIndex, newIndex))
    }
  }, [collapsed, items, onItemsChange])

  const sidebarStyle = useMemo(() => ({ width: `${width}px` }), [width])

  return (
    <aside
      style={sidebarStyle}
      className={cn(
        "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
        "border-r border-border/50 bg-card/70 backdrop-blur-xl",
        "shadow-[0_10px_40px_rgba(0,0,0,0.08)] transition-[width,box-shadow,background-color] duration-200 ease-out",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] opacity-60 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]" />

      <nav className={cn("relative z-10 flex-1 px-2 py-3", collapsed ? "overflow-hidden" : "overflow-y-auto scroll-smooth overscroll-contain")}>
        {mounted && !collapsed ? (
          <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} collapsed={collapsed} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <SidebarItem key={item.id} item={item} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} collapsed={collapsed} />
            ))}
          </div>
        )}

        <div className="mt-3 border-t border-border/10">
          {!collapsed && (
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Pinned
            </p>
          )}
          {collapsed ? (
            <GlassTooltip label="Project">
              <button
                type="button"
                onClick={() => onTabChange("project")}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center justify-center rounded-md px-0 py-2 font-medium transition-colors duration-150",
                  activeTab === "project"
                    ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icons.Files size={16} strokeWidth={1.5} className="shrink-0" />
              </button>
            </GlassTooltip>
          ) : (
            <button
              type="button"
              onClick={() => onTabChange("project")}
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-[13px] font-medium transition-colors duration-150",
                activeTab === "project"
                  ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icons.Files size={16} strokeWidth={1.5} className="shrink-0" />
              <span className="flex-1 truncate">Project</span>
            </button>
          )}
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

      <VersionUpdateModal open={versionModalOpen} onOpenChange={setVersionModalOpen} />
    </aside>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
