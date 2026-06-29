"use client"

import { useEffect, useMemo, useRef } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { ESSENTIAL_SLASH_COMMANDS, type SlashCommand } from "@/hooks/useSlashCommands"
import {
  filterSlashCommands,
  groupSlashCommands,
} from "@/lib/slashCommandFilter"

type Props = {
  commands: SlashCommand[]
  filter: string
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
  prefix?: "/" | "@"
  groupLabel?: string
}

export function SlashCommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
  prefix = "/",
  groupLabel,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  const liveFilter = useMemo(() => {
    if (typeof document === "undefined") return filter
    const active = document.activeElement
    if (!(active instanceof HTMLTextAreaElement)) return filter
    const match = active.value.match(/^([/@])(\S*)$/)
    if (!match || match[1] !== prefix) return filter
    return match[2] ?? filter
  }, [filter, prefix])

  const commandsWithEssentials = useMemo(() => {
    if (prefix !== "/") return commands
    const byName = new Map(commands.map((command) => [command.name, command]))
    for (const command of ESSENTIAL_SLASH_COMMANDS) {
      if (!byName.has(command.name)) byName.set(command.name, command)
    }
    return Array.from(byName.values())
  }, [commands, prefix])

  const filtered = useMemo(() => {
    const result = filterSlashCommands(commandsWithEssentials, liveFilter)
    const query = liveFilter.trim().toLowerCase()
    if (prefix !== "/" || !query || !"status".startsWith(query)) return result
    const status = commandsWithEssentials.find((command) => command.name === "status")
    if (!status) return result
    return [status, ...result.filter((command) => command.name !== "status")]
  }, [commandsWithEssentials, liveFilter, prefix])
  const groups = groupSlashCommands(filtered)

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (filtered.length === 0) return null

  return (
    <motion.div
      ref={listRef}
      initial={{ opacity: 0, scaleY: 0.86, y: 6 }}
      animate={{
        opacity: 1,
        scaleY: 1,
        y: 0,
        transition: {
          duration: 0.22,
          ease: [0.22, 1, 0.36, 1],
          when: "beforeChildren",
          staggerChildren: 0.03,
        },
      }}
      exit={{
        opacity: 0,
        scaleY: 0.92,
        y: 4,
        transition: { duration: 0.16, ease: "easeInOut" },
      }}
      className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full origin-bottom overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      {groups.map((group) => {
        let groupOffset = 0
        for (const previous of groups) {
          if (previous.id === group.id) break
          groupOffset += previous.commands.length
        }
        return (
          <div key={group.id} className="py-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">
              {group.label}
            </p>
            {group.commands.map((cmd, i) => {
              const absoluteIndex = groupOffset + i
              return (
                <motion.button
                  key={cmd.name}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                    absoluteIndex === selectedIndex
                      ? "bg-muted text-popover-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect(cmd)
                  }}
                >
                  <span className="font-[family:var(--font-jetbrains-mono)] text-sm font-medium text-foreground">
                    {prefix}{cmd.name}
                  </span>
                  {cmd.description && (
                    <span className="text-xs text-muted-foreground">
                      {cmd.description}
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>
        )
      })}
    </motion.div>
  )
}

export function getFilteredCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  return filterSlashCommands(commands, filter)
}
