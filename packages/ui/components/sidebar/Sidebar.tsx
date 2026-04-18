"use client"

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
      activationConstraint: { distance: 4 },
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
          "flex h-full w-55 flex-col",
          "border-r border-border/50 bg-card",
          className,
        )}
      >
        {/* ── Draggable nav items (kanban cards) ── */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

          {/* ── Project (static, not draggable) ── */}
          <div className="mt-3 border-t border-border/30 pt-3">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pinned
            </p>
            <button
              type="button"
              onClick={() => setActiveTab("project")}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-all",
                activeTab === "project"
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <ProjectIcon />
              <span>Project</span>
            </button>
          </div>
        </nav>

        {/* ── Version Update at the bottom ── */}
        <div className="border-t border-border/30 px-2.5 py-2.5">
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

/* ── Project icon (folder) ── */
function ProjectIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}
