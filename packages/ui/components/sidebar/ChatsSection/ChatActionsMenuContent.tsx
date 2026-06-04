"use client"

import { Icons } from "@/components/icons"
import { MenuAction } from "../ProjectsSection/MenuAction"

export type ChatActionsMenuContentProps = {
  onOpenInNewWindow?: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}

export function ChatActionsMenuContent({
  onOpenInNewWindow,
  onRename,
  onArchive,
  onDelete,
}: ChatActionsMenuContentProps) {
  return (
    <>
      {onOpenInNewWindow && (
        <>
          <MenuAction
            label="Open in new window"
            icon={<OpenInNewWindowIcon />}
            onClick={onOpenInNewWindow}
          />
          <div className="my-0.5 h-px bg-border/20" />
        </>
      )}
      <MenuAction
        label="Rename"
        icon={<Icons.Edit size={14} strokeWidth={1.5} />}
        onClick={onRename}
      />
      <div className="my-0.5 h-px bg-border/20" />
      <MenuAction
        label="Archive"
        icon={<Icons.Archive size={14} strokeWidth={1.5} />}
        onClick={onArchive}
      />
      <MenuAction
        label="Delete"
        icon={<Icons.Trash size={14} strokeWidth={1.5} />}
        onClick={onDelete}
        danger
      />
    </>
  )
}

function OpenInNewWindowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="2" width="8.5" height="8.5" rx="1.6" />
      <path d="M3.1 5.5h-.5A1.6 1.6 0 0 0 1 7.1v6.3A1.6 1.6 0 0 0 2.6 15h6.3a1.6 1.6 0 0 0 1.6-1.6v-.5" />
    </svg>
  )
}
