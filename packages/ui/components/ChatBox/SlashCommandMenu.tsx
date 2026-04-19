"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { SlashCommand } from "@/hooks/useSlashCommands"

type Props = {
  commands: SlashCommand[]
  filter: string
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}

export function SlashCommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(filter.toLowerCase()),
  )

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (filtered.length === 0) return null

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          className={cn(
            "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
            i === selectedIndex
              ? "bg-muted text-popover-foreground"
              : "text-muted-foreground hover:bg-muted/50",
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(cmd)
          }}
        >
          <span className="text-sm font-medium text-foreground">
            /{cmd.name}
          </span>
          {cmd.description && (
            <span className="text-xs text-muted-foreground">
              {cmd.description}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function getFilteredCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  return commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(filter.toLowerCase()),
  )
}
