"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Icons } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { cn } from "@/lib/utils"
import type { MouseEvent } from "react"
import type { Space } from "@/types/space"
import { SpaceActionsMenu } from "./SpaceActionsMenu"

const MENU_SPRING = {
  type: "spring" as const,
  stiffness: 320,
  damping: 30,
  mass: 0.95,
}

type Props = {
  spaces: Space[]
  actionMenuSpaceId: string | null
  gradientForSpace: (space: Space) => string
  onSwitch: (spaceId: string) => void
  onContextMenu: (event: MouseEvent<HTMLElement>, space: Space) => void
  onActionMenuChange: (spaceId: string | null) => void
  onNewChat: (space: Space) => void
  onRename: (space: Space) => void
  onArchive: (space: Space) => void
  onDelete: (space: Space) => void
  onCloseOverflow: () => void
}

export function SpacesOverflowMenu({
  spaces,
  actionMenuSpaceId,
  gradientForSpace,
  onSwitch,
  onContextMenu,
  onActionMenuChange,
  onNewChat,
  onRename,
  onArchive,
  onDelete,
  onCloseOverflow,
}: Props) {
  return (
    <div className="max-h-[150px] overflow-y-auto pr-1">
      {spaces.map((space) => (
        <div key={space.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onCloseOverflow()
              onSwitch(space.id)
            }}
            onContextMenu={(event) => onContextMenu(event, space)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md border-0 px-2.5 py-2 text-left shadow-none outline-none transition-colors hover:bg-white/[0.08] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          >
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full bg-gradient-to-br shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
                gradientForSpace(space),
              )}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
              {space.name}
            </span>
          </button>
          <Popover
            open={actionMenuSpaceId === space.id}
            onOpenChange={(open) => onActionMenuChange(open ? space.id : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(event) => event.stopPropagation()}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/65 transition-all hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <Icons.MoreVertical size={14} strokeWidth={1.5} />
              </button>
            </PopoverTrigger>
            <AnimatePresence>
              {actionMenuSpaceId === space.id && (
                <PopoverContent
                  forceMount
                  align="end"
                  side="right"
                  sideOffset={4}
                  className={cn("w-44 gap-0 rounded-2xl p-1.5", GLASS_POPOVER)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{
                      opacity: { duration: 0.2 },
                      scale: MENU_SPRING,
                      y: MENU_SPRING,
                    }}
                    style={{ transformOrigin: "top left" }}
                  >
                    <SpaceActionsMenu
                      space={space}
                      onNewChat={(targetSpace) => {
                        onCloseOverflow()
                        onNewChat(targetSpace)
                      }}
                      onRename={onRename}
                      onArchive={onArchive}
                      onDelete={onDelete}
                    />
                  </motion.div>
                </PopoverContent>
              )}
            </AnimatePresence>
          </Popover>
        </div>
      ))}
    </div>
  )
}
