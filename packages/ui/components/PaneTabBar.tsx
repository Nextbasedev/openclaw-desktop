"use client"

import { useState, useCallback } from "react"
import { VscClose } from "react-icons/vsc"
import { Icons } from "@/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { EditorTab } from "@/lib/editorGroups"

type Props = {
  groupId: "group-1" | "group-2"
  tabs: EditorTab[]
  activeTabId: string | null
  focused: boolean
  onSelectTab: (groupId: "group-1" | "group-2", tabId: string) => void
  onCloseTab: (tabId: string) => void
  onMoveTab: (
    tabId: string,
    sourceGroupId: "group-1" | "group-2",
    targetGroupId: "group-1" | "group-2",
  ) => void
  onFocus: (groupId: "group-1" | "group-2") => void
}

export function PaneTabBar({
  groupId,
  tabs,
  activeTabId,
  focused,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onFocus,
}: Props) {
  const [dragOver, setDragOver] = useState(false)

  const handleDragStart = useCallback(
    (e: React.DragEvent, tabId: string) => {
      e.dataTransfer.setData("text/tab-id", tabId)
      e.dataTransfer.setData("text/source-group", groupId)
      e.dataTransfer.effectAllowed = "move"
    },
    [groupId],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const tabId = e.dataTransfer.getData("text/tab-id")
      const sourceGroup = e.dataTransfer.getData(
        "text/source-group",
      ) as "group-1" | "group-2"
      if (tabId && sourceGroup) {
        onMoveTab(tabId, sourceGroup, groupId)
      }
    },
    [groupId, onMoveTab],
  )

  return (
    <div
      className={cn(
        "relative flex h-[35px] shrink-0 items-end overflow-x-auto overflow-y-hidden bg-card scrollbar-hide",
        dragOver && "ring-1 ring-inset ring-primary/30",
      )}
      onWheel={(e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.currentTarget.scrollLeft += e.deltaY
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => onFocus(groupId)}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-px bg-border/50" />
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                draggable
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onClick={() => onSelectTab(groupId, tab.id)}
                className={cn(
                  "group relative flex h-[34px] w-42 shrink-0 items-center gap-1 border-x border-t px-3 pb-[7px] pt-[7px] text-left transition-[background-color,border-color,box-shadow] duration-200",
                  isActive
                    ? "z-10 -mb-px rounded-t-lg border-border/50 bg-background"
                    : "rounded-t-lg border-transparent bg-transparent text-foreground/65 hover:bg-foreground/[0.045] dark:text-white/68 dark:hover:bg-white/[0.05]",
                )}
              >
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    isActive
                      ? "bg-foreground/[0.06] text-foreground/55 dark:bg-white/[0.06] dark:text-white/60"
                      : "bg-transparent text-foreground/35 dark:text-white/38",
                  )}
                >
                  {tab.kind === "topic" ? (
                    <Icons.Project
                      size={12}
                      strokeWidth={1.7}
                      className="size-3.5"
                    />
                  ) : (
                    <Icons.Chat
                      size={12}
                      strokeWidth={1.7}
                      className="size-3.5"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                    <span
                      className={cn(
                        "truncate text-[11px]",
                        isActive
                          ? "text-foreground/38 dark:text-white/40"
                          : "text-foreground/30 dark:text-white/30",
                      )}
                    >
                      {tab.subtitle}
                    </span>
                    <span className="shrink-0 text-[10px] text-foreground/20 dark:text-white/20">
                      /
                    </span>
                    <span
                      className={cn(
                        "truncate text-[11.5px] font-medium",
                        isActive
                          ? "text-foreground/78 dark:text-white/82"
                          : "text-foreground/68 dark:text-white/72",
                      )}
                    >
                      {tab.title}
                    </span>
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      e.stopPropagation()
                      onCloseTab(tab.id)
                    }
                  }}
                  className={cn(
                    "ml-1 flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
                    isActive
                      ? "text-foreground/36 hover:bg-foreground/[0.06] hover:text-foreground/72 dark:text-white/36 dark:hover:bg-white/[0.06] dark:hover:text-white/72"
                      : "text-foreground/28 hover:bg-foreground/[0.05] hover:text-foreground/58 dark:text-white/28 dark:hover:bg-white/[0.05] dark:hover:text-white/58",
                  )}
                >
                  <VscClose className="size-3.5 cursor-pointer" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              sideOffset={6}
              className="min-h-6 max-w-[360px] rounded-[12px] border border-white/15 bg-background/55 px-2.5 py-1 text-[11.5px] font-medium leading-4 text-foreground/90 shadow-xl shadow-black/20 backdrop-blur-xl dark:border-white/12 dark:bg-zinc-950/55 [&>svg]:hidden"
            >
              <span className="block truncate px-px py-px">{tab.title}</span>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
