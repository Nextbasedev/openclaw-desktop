import { Icons } from "@/components/icons"
import { useState, useCallback, useMemo, useEffect, useId } from "react"
import { VersionUpdateButton } from "./VersionUpdateButton"
import { VersionUpdateModal } from "./VersionUpdateModal"
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
  { id: "workspace", label: "Workspace", icon: "workspace" },
  { id: "connect", label: "Connect", icon: "connect" },
  { id: "settings", label: "Settings", icon: "settings" },
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
  isSettingsMode: boolean
  onToggleSettingsMode: (val: boolean) => void
  onBackToMain: () => void
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
  isSettingsMode,
  onBackToMain,
}: SidebarProps) {
  const [mounted, setMounted] = useState(false)
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const id = useId()

  useEffect(() => {
    setMounted(true)
  }, [])

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
      if (collapsed) return
      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex((i) => i.id === active.id)
        const newIndex = items.findIndex((i) => i.id === over.id)
        onItemsChange(arrayMove(items, oldIndex, newIndex))
      }
    },
    [collapsed, items, onItemsChange],
  )

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

      <nav className={cn("relative z-10 flex-1 overflow-y-auto px-2 py-3", "scroll-smooth overscroll-contain")}>
        {isSettingsMode ? (
          <div className="flex h-full flex-col gap-1">
            <button
              onClick={onBackToMain}
              title="Back to App"
              className={cn(
                "flex w-full cursor-pointer items-center rounded-md text-left font-medium transition-colors hover:text-foreground",
                collapsed ? "justify-center px-0 py-2" : "gap-1 px-2.5 py-1 text-[12px] text-muted-foreground",
              )}
            >
              <Icons.Back size={16} strokeWidth={1.5} />
              {!collapsed && <span>Back to App</span>}
            </button>

            {!collapsed && <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Personal</div>}
            <SettingsItem label="Usage" icon="usage" active={activeTab === "usage"} onClick={() => onTabChange("usage")} collapsed={collapsed} />
            <SettingsItem label="Memory" icon="memory" active={activeTab === "memory"} onClick={() => onTabChange("memory")} collapsed={collapsed} />

            {!collapsed && <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">System</div>}
            <SettingsItem label="Account" icon="user" active={activeTab === "account"} onClick={() => onTabChange("account")} collapsed={collapsed} />
            <SettingsItem label="Appearance" icon="settings" active={activeTab === "personalization"} onClick={() => onTabChange("personalization")} collapsed={collapsed} />
            <SettingsItem label="Data Control" icon="grid" active={activeTab === "data-control"} onClick={() => onTabChange("data-control")} collapsed={collapsed} />
            <SettingsItem label="Maintenance" icon="wrench" active={activeTab === "maintenance"} onClick={() => onTabChange("maintenance")} collapsed={collapsed} />

            <div className="mt-auto pt-4">
              <SettingsItem label="Help" icon="help" active={activeTab === "help"} onClick={() => onTabChange("help")} collapsed={collapsed} />
            </div>
          </div>
        ) : (
          <>
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
              <button
                type="button"
                title="Project"
                onClick={() => onTabChange("project")}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center rounded-md text-left font-medium transition-colors duration-150",
                  collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1 text-[13px]",
                  activeTab === "project"
                    ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icons.Files size={16} strokeWidth={1.5} className="shrink-0" />
                {!collapsed && <span className="flex-1 truncate">Project</span>}
              </button>
            </div>
          </>
        )}
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

function SettingsItem({ label, icon, active, onClick, collapsed }: {
  label: string
  icon: string
  active: boolean
  onClick: () => void
  collapsed: boolean
}) {
  const iconMap: Record<string, any> = {
    usage: Icons.Automations,
    memory: Icons.Memory,
    user: Icons.UserAccount,
    settings: Icons.Settings,
    grid: Icons.Grid,
    wrench: Icons.Wrench,
    help: Icons.Help,
  }

  const Icon = iconMap[icon] || Icons.Settings

  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex w-full cursor-pointer items-center rounded-md font-normal transition-colors",
        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1.5 text-left text-[13px]",
        active
          ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
          : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={active ? 2 : 1.5} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}

export { DEFAULT_DRAGGABLE_ITEMS }
export type { SidebarNavItem }
