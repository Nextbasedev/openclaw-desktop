"use client"

import { Icons } from "@/components/icons"
import { MenuAction } from "./ProjectsSection/MenuAction"
import type { Space } from "@/types/space"

type Props = {
  space: Space
  onNewChat: (space: Space) => void
  onRename: (space: Space) => void
  onArchive: (space: Space) => void
  onDelete: (space: Space) => void
}

export function SpaceActionsMenu({
  space,
  onNewChat,
  onRename,
  onArchive,
  onDelete,
}: Props) {
  return (
    <>
      <MenuAction
        label="New Chat"
        icon={<Icons.BubbleChat size={14} strokeWidth={1.5} />}
        onClick={() => onNewChat(space)}
      />
      <div className="my-0.5 h-px bg-border/20" />
      <MenuAction
        label="Rename"
        icon={<Icons.Edit size={14} strokeWidth={1.5} />}
        onClick={() => onRename(space)}
      />
      <MenuAction
        label="Archive"
        icon={<Icons.Archive size={14} strokeWidth={1.5} />}
        onClick={() => onArchive(space)}
      />
      <MenuAction
        label="Delete"
        icon={<Icons.Trash size={14} strokeWidth={1.5} />}
        onClick={() => onDelete(space)}
        danger
      />
    </>
  )
}
