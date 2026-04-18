import { Icons } from "@/components/icons"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"

export type SidebarNavItem = {
  id: string
  label: string
  icon: "chat" | "skill" | "usage" | "workspace" | "memory"
}

type SidebarItemProps = {
  item: SidebarNavItem
  isActive: boolean
  onClick: () => void
}

export function SidebarItem({ item, isActive, onClick }: SidebarItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium",
        "transition-[background-color,color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform] duration-150 ease-in-out",
        "cursor-default active:cursor-default",
        isDragging && "z-50 scale-[1.02] shadow-lg shadow-black/20 ring-1 ring-primary/20 cursor-grabbing",
        isActive
          ? "bg-accent text-accent-foreground shadow-sm"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
      {...attributes}
      {...listeners}
    >
      <NavIcon type={item.icon} />
      <span className="flex-1 truncate">{item.label}</span>
    </button>
  )
}

/* ── Navigation icons ── */
function NavIcon({ type }: { type: SidebarNavItem["icon"] }) {
  const iconMap: Record<string, React.ElementType> = {
    chat: Icons.Chat,
    skill: Icons.Tasks,
    usage: Icons.Dashboard,
    workspace: Icons.Home,
    memory: Icons.Memory,
  }

  const Icon = iconMap[type] || Icons.Chat

  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <Icon size={16} strokeWidth={1.5} />
    </span>
  )
}

