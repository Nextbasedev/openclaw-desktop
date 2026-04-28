"use client"

import { useState } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { Icons } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useLongPressDrag } from "@/hooks/useLongPressDrag"
import { MenuAction } from "./MenuAction"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { formatCompactTime } from "@/utils/formatCompactTime"
import type { FullTopic } from "@/types/project"

type Props = {
  topicId: string
  topics: FullTopic[]
  isActive: boolean
  isPinned: boolean
  onClick: () => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}

export function SortableTopicRow({ topicId, topics, isActive, isPinned, onClick, onPin, onRename, onArchive, onDelete }: Props) {
  const controls = useDragControls()
  const longPress = useLongPressDrag(controls)
  const [menuOpen, setMenuOpen] = useState(false)
  const topic = topics.find((t) => t.id === topicId)
  if (!topic) return null

  const timeStr = formatCompactTime(topic.updatedAt)

  return (
    <Reorder.Item
      value={topicId}
      dragListener={false}
      dragControls={controls}
      as="div"
      layout="position"
      transition={{ layout: { type: "tween", duration: 0.15, ease: [0.2, 0, 0, 1] } }}
      className="group/row relative flex items-center rounded-md"
      style={{ position: "relative", boxShadow: "none" }}
      whileDrag={{ boxShadow: "none" }}
      {...longPress}
    >
      <button
        onClick={onClick}
        className={cn(
          "flex flex-1 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors duration-150",
          isActive ? "bg-foreground/7 text-foreground" : "text-foreground/80 hover:bg-foreground/4 hover:text-foreground",
        )}
      >
        <span
          onClick={(e) => { e.stopPropagation(); onPin() }}
          title={isPinned ? "Unpin" : "Pin"}
          className={cn(
            "flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all duration-150",
            isPinned
              ? isActive ? "text-foreground" : "text-foreground/70"
              : "opacity-0 group-hover/row:opacity-100 text-muted-foreground/40 hover:text-foreground",
          )}
        >
          <Icons.Pin size={15} strokeWidth={isPinned ? 2 : 1.5} />
        </span>
        <span className="flex-1 truncate text-[13px] font-light">{topic.name}</span>
      </button>

      <div className="absolute right-1 flex h-5 w-5 items-center justify-center">
        <span className={cn(
          "absolute text-[10px] text-muted-foreground/35 tabular-nums pointer-events-none select-none transition-opacity duration-100",
          isActive || menuOpen ? "opacity-0" : "group-hover/row:opacity-0",
        )}>
          {timeStr}
        </span>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              title="Topic options"
              className={cn(
                "absolute flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-all duration-100",
                isActive || menuOpen
                  ? "opacity-100 text-muted-foreground/60 hover:text-foreground"
                  : "opacity-0 group-hover/row:opacity-100 text-muted-foreground/50 hover:text-foreground",
              )}
            >
              <Icons.MoreVertical size={14} strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="right" sideOffset={4} className={cn("w-36 p-1 gap-0", GLASS_POPOVER)}>
            <MenuAction label="Rename" icon={<Icons.Edit size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onRename() }} />
            <div className="my-0.5 h-px bg-border/20" />
            <MenuAction label="Archive" icon={<Icons.Archive size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onArchive() }} />
            <MenuAction label="Delete" icon={<Icons.Trash size={14} strokeWidth={1.5} />} onClick={() => { setMenuOpen(false); onDelete() }} danger />
          </PopoverContent>
        </Popover>
      </div>
    </Reorder.Item>
  )
}
