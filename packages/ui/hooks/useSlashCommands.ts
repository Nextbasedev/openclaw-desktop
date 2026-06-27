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

type LocalSkillEntry = {
  slug: string
  name: string
  description: string
  source: string
  installed: boolean
  enabled: boolean
}

type DiscoverResponse = {
  results: LocalSkillEntry[]
}

let cachedCommands: SlashCommand[] | null = null

function mapLocalSkill(skill: LocalSkillEntry): SlashCommand {
  return {
    name: skill.slug,
    description: skill.description || skill.name,
    category: "skills",
    source: "skill",
    scope: "text",
    acceptsArgs: true,
  }
}

function fetchInstalledSkills(): Promise<SlashCommand[]> {
  return invoke<DiscoverResponse>(
    "middleware_skills_discover",
    {
      input: {
        includeLocal: true,
        includeClawHub: false,
        limit: 200,
      },
    },
  )
    .then((res) =>
      res.results
        .filter((s) => s.installed)
        .map(mapLocalSkill),
    )
    .catch(() => [])
}

export function useSlashCommands() {
  const [commands, setCommands] = useState<SlashCommand[]>(
    cachedCommands ?? [],
  )
  const [installedSkills, setInstalledSkills] = useState<
    SlashCommand[]
  >([])
  const [loading, setLoading] = useState(!cachedCommands)
  const commandsFetched = useRef(false)

  const ensureLoaded = () => {
    fetchInstalledSkills().then(setInstalledSkills)

    if (commandsFetched.current || cachedCommands) return
    commandsFetched.current = true

    invoke<CommandsResponse>("middleware_commands_list", {})
      .then((res) => {
        if (res.commands && res.commands.length > 0) {
          cachedCommands = res.commands
          setCommands(res.commands)
        } else {
          cachedCommands = []
          setCommands([])
        }
      })
      .catch(() => {
        cachedCommands = []
        setCommands([])
      })
      .finally(() => setLoading(false))
  }

  return { commands, installedSkills, loading, ensureLoaded }
}
