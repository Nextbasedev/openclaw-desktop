import { Icons } from "@/components/icons"
import { useCallback, useMemo } from "react"
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
import { SidebarItem, type SidebarNavItem } from "./SidebarItem"

const DEFAULT_DRAGGABLE_ITEMS: SidebarNavItem[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "skill", label: "Skill", icon: "skill" },
  { id: "usage", label: "Usage", icon: "usage" },
  { id: "workspace", label: "Workspace", icon: "workspace" },
  { id: "memory", label: "Memory", icon: "memory" },
]

type SidebarProps = {
  className?: string
  width?: number
  onResizeStart?: () => void
  activeTab: string
  onTabChange: (tab: string) => void
  items: SidebarNavItem[]
  onItemsChange: (items: SidebarNavItem[]) => void
}

export function Sidebar({
  className,
  width = 220,
  onResizeStart,
  activeTab,
  onTabChange,
  items,
  onItemsChange,
}: SidebarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex((i) => i.id === active.id)
        const newIndex = items.findIndex((i) => i.id === over.id)
        onItemsChange(arrayMove(items, oldIndex, newIndex))
      }
    },
    [items, onItemsChange],
  )

  const sidebarStyle = useMemo(
    () => ({ width: `${width}px` }),
    [width],
  )

  return (
    <aside
      style={sidebarStyle}
      className={cn(
        "group/sidebar relative flex h-full shrink-0 flex-col overflow-hidden",
        "border-r border-border/50 bg-card/70 backdrop-blur-xl",
        "shadow-[0_10px_40px_rgba(0,0,0,0.08)] transition-[box-shadow,background-color] duration-200 ease-out",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.04)_100%)] opacity-60 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40 dark:bg-white/10" />

      <nav
        className={cn(
          "relative z-10 flex-1 overflow-y-auto px-2 py-3",
          "scroll-smooth overscroll-contain",
        )}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-1">
              {items.map((item) => (
                <SidebarItem
                  key={item.id}
                  item={item}
                  isActive={activeTab === item.id}
                  onClick={() => onTabChange(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="mt-3 border-t border-border/10">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Pinned
          </p>
          <button
            type="button"
            onClick={() => onTabChange("project")}
            className={cn(
              "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-[12px] font-medium transition-colors duration-150",
              activeTab === "project"
                ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md ring-1 ring-inset ring-foreground/10"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icons.Files size={16} strokeWidth={1.5} className="shrink-0" />
            <span className="flex-1 truncate">Project</span>
          </button>
        </div>
      </nav>

      {/* Resize handle */}
      <button
        type="button"
        aria-label="Resize sidebar"
        onMouseDown={onResizeStart}
        className={cn(
          "absolute right-0 top-0 z-20 h-full w-1 -translate-x-1/2 cursor-col-resize",
          "bg-transparent transition-colors duration-150",
        )}
      />
    </aside>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
