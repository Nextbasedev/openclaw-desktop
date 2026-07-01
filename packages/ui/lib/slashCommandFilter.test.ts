import { describe, expect, it } from "vitest"

import type { SlashCommand } from "@/hooks/useSlashCommands"
import { filterSlashCommands } from "./slashCommandFilter"

function command(name: string, description: string): SlashCommand {
  return {
    name,
    description,
    source: "native",
    scope: "both",
    acceptsArgs: false,
  }
}

describe("slash command filter", () => {
  const commands = [
    command("commands", "List all slash commands."),
    command("context", "Explain how context is built and used."),
    command("export-session", "Export current session to HTML file with full system prompt."),
    command("status", "Show the current session status."),
  ]

  it("filters typed queries by command name instead of description", () => {
    expect(filterSlashCommands(commands, "status").map((item) => item.name)).toEqual(["status"])
  })

  it("keeps the full command list for an empty query", () => {
    expect(filterSlashCommands(commands, "").map((item) => item.name)).toEqual([
      "commands",
      "context",
      "export-session",
      "status",
    ])
  })

  it("ranks prefix command-name matches first", () => {
    expect(filterSlashCommands(commands, "sta")[0]?.name).toBe("status")
  })
})
