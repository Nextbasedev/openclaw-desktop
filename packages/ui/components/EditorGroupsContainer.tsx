"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { EditorGroupsState } from "@/lib/editorGroups"

type Props = {
  state: EditorGroupsState
  renderContent: (
    groupId: "group-1" | "group-2",
  ) => ReactNode
  onFocusGroup?: (groupId: "group-1" | "group-2") => void
}

export function EditorGroupsContainer({
  state,
  renderContent,
  onFocusGroup,
}: Props) {
  const isSplit = state.groups.length > 1

  return (
    <div className="relative flex h-full w-full">
      {state.groups.map((group) => (
        <div
          key={group.id}
          className={cn(
            "flex flex-col overflow-hidden",
            isSplit ? "w-1/2" : "w-full",
          )}
          onMouseDown={() => {
            if (isSplit && group.id !== state.focusedGroupId) {
              onFocusGroup?.(group.id)
            }
          }}
        >
          <div className="flex-1 overflow-hidden">
            {renderContent(group.id)}
          </div>
        </div>
      ))}
      {isSplit && (
        <div className="absolute left-1/2 top-0 bottom-0 z-10 w-px bg-border/50" />
      )}
    </div>
  )
}
