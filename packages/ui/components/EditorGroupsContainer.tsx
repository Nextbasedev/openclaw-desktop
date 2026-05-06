"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { EditorGroupsState } from "@/lib/editorGroups"

type Props = {
  state: EditorGroupsState
  splitRatio?: number
  renderContent: (
    groupId: "group-1" | "group-2",
  ) => ReactNode
  onFocusGroup?: (groupId: "group-1" | "group-2") => void
  onResizeStart?: () => void
}

export function EditorGroupsContainer({
  state,
  splitRatio = 0.5,
  renderContent,
  onFocusGroup,
  onResizeStart,
}: Props) {
  const isSplit = state.groups.length > 1
  const leftWidth = `${splitRatio * 100}%`
  const rightWidth = `${(1 - splitRatio) * 100}%`

  return (
    <div className="relative flex h-full w-full">
      {state.groups.map((group, index) => (
        <div
          key={group.id}
          className={cn(
            "flex flex-col overflow-hidden",
            !isSplit && "w-full",
          )}
          style={
            isSplit
              ? { width: index === 0 ? leftWidth : rightWidth }
              : undefined
          }
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
        <>
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-border/50"
            style={{ left: leftWidth }}
          />
          <button
            type="button"
            aria-label="Resize split chat panes"
            title="Resize split chat panes"
            className="absolute bottom-0 top-0 z-20 w-3 -translate-x-1/2 cursor-col-resize bg-transparent"
            style={{ left: leftWidth }}
            onMouseDown={(event) => {
              event.preventDefault()
              onResizeStart?.()
            }}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-primary/40" />
          </button>
        </>
      )}
    </div>
  )
}
