import { useState, useRef, useEffect, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { Reorder, useDragControls } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

export type SidebarNavItem = {
  id: string
  label: string
  icon: "chat" | "skill" | "usage" | "memory" | "connect"
}

type SidebarItemProps = {
  item: SidebarNavItem
  isActive: boolean
  onClick: () => void
  href?: string
  collapsed?: boolean
  draggable?: boolean
}

export function SidebarItem({
  item,
  isActive,
  onClick,
  href,
  collapsed = false,
  draggable = false,
}: SidebarItemProps) {
  const dragControls = useDragControls()
  const interactiveClassName = cn(
    "group flex w-full min-w-0 items-center rounded-md font-normal",
    "gap-2.5 text-left text-[13px]",
    collapsed ? "px-2.5 py-2" : "px-2.5 py-1.5",
    "transition-[background-color,color,opacity] duration-150 ease-in-out",
    "cursor-pointer",
    isActive
      ? "text-foreground"
      : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
  )

  const content = (
    <>
      <NavIcon type={item.icon} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </>
  )

  const btn = href ? (
    <a
      href={href}
      draggable={false}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onClick()
      }}
      data-testid={`sidebar-nav-${item.id}`}
      className={interactiveClassName}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      onClick={onClick}
      data-testid={`sidebar-nav-${item.id}`}
      className={interactiveClassName}
    >
      {content}
    </button>
  )

  if (collapsed) {
    return <GlassTooltip label={item.label}>{btn}</GlassTooltip>
  }

  if (!draggable) {
    return btn
  }

  return (
    <Reorder.Item
      value={item.id}
      as="div"
      dragControls={dragControls}
      dragListener={false}
      layout="position"
      transition={{ layout: { type: "tween", duration: 0.15, ease: [0.2, 0, 0, 1] } }}
      style={{ position: "relative", boxShadow: "none", cursor: "pointer", touchAction: "none" }}
      whileDrag={{ boxShadow: "none", cursor: "grabbing" }}
      onPointerDown={(event) => dragControls.start(event)}
    >
      {btn}
    </Reorder.Item>
  )
}

export function GlassTooltip({
  label,
  children,
  disabled,
}: {
  label: string
  children: React.ReactNode
  disabled?: boolean
}) {
  const [show, setShow] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  function handleEnter() {
    if (disabled) return
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
        !disabled &&
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
                "slide-in-from-left-1 duration-150",
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
    connect: Icons.Globe,
  }

  const Icon = iconMap[type] || Icons.Chat

  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <Icon size={16} strokeWidth={1.5} />
    </span>
  )
}
