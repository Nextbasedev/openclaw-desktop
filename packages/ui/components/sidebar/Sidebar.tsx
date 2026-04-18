import { Icons } from "@/components/icons"
import { useState, useCallback } from "react"
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
import { VersionUpdateButton } from "./VersionUpdateButton"
import { VersionUpdateModal } from "./VersionUpdateModal"

/* ── Default draggable nav items ── */
const DEFAULT_DRAGGABLE_ITEMS: SidebarNavItem[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "skill", label: "Skill", icon: "skill" },
  { id: "usage", label: "Usage", icon: "usage" },
  { id: "workspace", label: "Workspace", icon: "workspace" },
  { id: "memory", label: "Memory", icon: "memory" },
]

type SidebarProps = {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [items, setItems] = useState<SidebarNavItem[]>(DEFAULT_DRAGGABLE_ITEMS)
  const [activeTab, setActiveTab] = useState<string>("chat")
  const [versionModalOpen, setVersionModalOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // increased distance for more reliable click vs drag
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        setItems((prev) => {
          const oldIndex = prev.findIndex((i) => i.id === active.id)
          const newIndex = prev.findIndex((i) => i.id === over.id)
          return arrayMove(prev, oldIndex, newIndex)
        })
      }
    },
    [],
  )

  return (
    <>
      <aside
        className={cn(
          "flex h-full w-[220px] flex-col",
          "border-r border-border/50 bg-card",
          className,
        )}
      >
        {/* ── Draggable nav items ── */}
        <nav 
          className={cn(
            "flex-1 overflow-y-auto px-2.5 py-3",
            "scroll-smooth overscroll-contain",
          )}
        >
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Navigation
          </p>

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
                    onClick={() => setActiveTab(item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* ── Project (static) ── */}
          <div className="mt-3 border-t border-border/10 pt-3">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Pinned
            </p>
            <button
              type="button"
              onClick={() => setActiveTab("project")}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-all duration-150",
                "cursor-default",
                activeTab === "project"
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icons.Files size={16} strokeWidth={1.5} />
              <span>Project</span>
            </button>
          </div>
        </nav>

        {/* ── Version Update at the bottom ── */}
        <div className="border-t border-border/10 px-2.5 py-2.5 bg-card/50">
          <VersionUpdateButton onClick={() => setVersionModalOpen(true)} />
        </div>
      </aside>

      <VersionUpdateModal
        open={versionModalOpen}
        onOpenChange={setVersionModalOpen}
      />
    </>
  )
}

