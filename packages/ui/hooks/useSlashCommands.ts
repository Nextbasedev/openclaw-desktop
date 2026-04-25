"use client"

import { useRef, useState } from "react"
import { invoke } from "@/lib/ipc"

export type SlashCommand = {
  name: string
  nativeName?: string
  textAliases?: string[]
  description: string
  category?: string
  source: "native" | "skill" | "plugin"
  scope: "text" | "native" | "both"
  acceptsArgs: boolean
}

type CommandsResponse = {
  commands: SlashCommand[]
}

const FALLBACK_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show available commands", source: "native", scope: "both", acceptsArgs: false },
  { name: "clear", description: "Clear conversation history", source: "native", scope: "both", acceptsArgs: false },
  { name: "reset", description: "Reset the current session", source: "native", scope: "both", acceptsArgs: false },
  { name: "new", description: "Start a new session", source: "native", scope: "both", acceptsArgs: false },
  { name: "stop", description: "Stop the current generation", source: "native", scope: "both", acceptsArgs: false },
  { name: "plan", description: "Create a step-by-step plan", source: "native", scope: "text", acceptsArgs: true },
  { name: "search", description: "Search the web for information", source: "native", scope: "text", acceptsArgs: true },
  { name: "code", description: "Generate or explain code", source: "native", scope: "text", acceptsArgs: true },
  { name: "summarize", description: "Summarize content or conversation", source: "native", scope: "text", acceptsArgs: true },
  { name: "debug", description: "Debug code or errors", source: "native", scope: "text", acceptsArgs: true },
  { name: "explain", description: "Explain a concept or code", source: "native", scope: "text", acceptsArgs: true },
  { name: "review", description: "Review code for issues", source: "native", scope: "text", acceptsArgs: true },
]

let cachedCommands: SlashCommand[] | null = null

export function useSlashCommands() {
  const [commands, setCommands] = useState<SlashCommand[]>(
    cachedCommands ?? FALLBACK_COMMANDS,
  )
  const [loading, setLoading] = useState(!cachedCommands)
  const fetched = useRef(false)

  const ensureLoaded = () => {
    if (fetched.current || cachedCommands) return
    fetched.current = true

    invoke<CommandsResponse>("middleware_commands_list", {})
      .then((res) => {
        if (res.commands && res.commands.length > 0) {
          cachedCommands = res.commands
          setCommands(res.commands)
        } else {
          cachedCommands = FALLBACK_COMMANDS
        }
      })
      .catch(() => {
        cachedCommands = FALLBACK_COMMANDS
      })
      .finally(() => setLoading(false))
  }

  return { commands, loading, ensureLoaded }
}
