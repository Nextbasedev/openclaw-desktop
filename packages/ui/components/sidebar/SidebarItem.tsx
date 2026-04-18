import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { Icons } from "@/components/icons"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"

export type SidebarNavItem = {
  id: string
  label: string
  icon: "chat" | "skill" | "usage" | "memory" | "settings" | "connect"
}

type SidebarItemProps = {
  item: SidebarNavItem
  isActive: boolean
  onClick: () => void
  collapsed?: boolean
}

export function SidebarItem({ item, isActive, onClick, collapsed = false }: SidebarItemProps) {
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

  const btn = (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={onClick}
      className={cn(
        "group flex w-full min-w-0 items-center rounded-md font-normal",
        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1 text-left text-[13px]",
        "transition-[background-color,color,text-decoration-color,fill,stroke,opacity,box-shadow,transform] duration-150 ease-in-out",
        "cursor-pointer active:cursor-grabbing",
        isDragging && "z-50 scale-[1.02] shadow-lg shadow-black/20 ring-1 ring-primary/20 cursor-grabbing",
        isActive
          ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
          : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
      )}
      {...attributes}
      {...listeners}
    >
      <NavIcon type={item.icon} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </button>
  )

  if (collapsed) {
    return <GlassTooltip label={item.label}>{btn}</GlassTooltip>
  }

  return btn
}

export function GlassTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  function handleEnter() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 10,
      })
    }
    setShow(true)
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show &&
        mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999]"
            style={{ top: pos.top, left: pos.left, transform: "translateY(-50%)" }}
          >
            <div
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5",
                "border border-white/[0.08] bg-card/90 backdrop-blur-xl",
                "text-[12px] font-medium text-foreground",
                "shadow-[0_4px_16px_rgba(0,0,0,0.3)]",
                "animate-in fade-in-0 slide-in-from-left-1 duration-150",
              )}
            >
              {label}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

function NavIcon({ type }: { type: SidebarNavItem["icon"] }) {
  const iconMap: Record<string, React.ElementType> = {
    chat: Icons.NewChat,
    skill: Icons.Plugins,
    usage: Icons.Automations,
    workspace: Icons.Project,
    memory: Icons.Memory,
    settings: Icons.Settings,
    connect: Icons.Globe,
  }

  const Icon = iconMap[type] || Icons.Chat

  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <Icon size={16} strokeWidth={1.5} />
    </span>
  )
}
