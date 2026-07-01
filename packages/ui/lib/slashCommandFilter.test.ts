import { describe, expect, it } from "vitest"
import { filterSlashCommands } from "@/lib/slashCommandFilter"
import type { SlashCommand } from "@/hooks/useSlashCommands"

const cmd = (over: Partial<SlashCommand> & { name: string }): SlashCommand => ({
  nativeName: undefined,
  textAliases: undefined,
  description: "",
  category: "chat",
  source: "native",
  scope: "both",
  acceptsArgs: false,
  ...over,
})

const commands: SlashCommand[] = [
  cmd({ name: "commands", description: "List all slash commands." }),
  cmd({ name: "context", description: "Explain how context is built and used." }),
  cmd({ name: "export-session", description: "Export current session to HTML file with full system prompt." }),
  cmd({ name: "export-trajectory", description: "Export a JSONL trajectory bundle for the active session." }),
  cmd({ name: "status", description: "Show the current session status." }),
  cmd({ name: "stop", description: "Stop the current run." }),
  cmd({ name: "new", description: "Start a new chat." }),
]

const names = (query: string) => filterSlashCommands(commands, query).map((c) => c.name)

describe("filterSlashCommands", () => {
  it("filters to the typed command name and drops description-only noise", () => {
    // Regression: '/status' previously surfaced commands/context/export-*
    // because their descriptions contained s-t-a-t-u-s as a subsequence.
    expect(names("status")).toEqual(["status"])
  })

  it("does not match a command via unrelated description prose", () => {
    // '/sta' previously matched '/new' via "Start a new chat".
    const result = names("sta")
    expect(result).toContain("status")
    expect(result).not.toContain("new")
    expect(result).not.toContain("context")
  })

  it("ranks exact name match first", () => {
    expect(names("status")[0]).toBe("status")
  })

  it("matches by name prefix", () => {
    expect(names("export")).toEqual(["export-session", "export-trajectory"])
  })

  it("does not include a command purely on a description word match", () => {
    // 'html' only appears in a description, not any name -> no match.
    expect(names("html")).toEqual([])
  })

  it("returns all commands for an empty query", () => {
    expect(filterSlashCommands(commands, "").length).toBe(commands.length)
  })

  it("matches native aliases when present", () => {
    const withAlias: SlashCommand[] = [
      cmd({ name: "clear", nativeName: "reset", description: "Clear conversation history." }),
    ]
    expect(filterSlashCommands(withAlias, "reset").map((c) => c.name)).toEqual(["clear"])
  })
})
