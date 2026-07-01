import type { SlashCommand } from "@/hooks/useSlashCommands"

export type CommandGroup = {
  id: string
  label: string
  commands: SlashCommand[]
}

const GROUP_LABELS: Record<string, string> = {
  chat: "Chat",
  tools: "Tools",
  files: "Files",
  cron: "Cron",
  models: "Models",
  skills: "Skills",
  native: "Chat",
  skill: "Skills",
  plugin: "Skills",
}

function commandGroup(command: SlashCommand): string {
  const category = command.category?.toLowerCase()
  if (category) {
    if (category.includes("file")) return "files"
    if (category.includes("cron") || category.includes("schedule")) return "cron"
    if (category.includes("model")) return "models"
    if (category.includes("tool")) return "tools"
    if (category.includes("skill")) return "skills"
    if (category.includes("chat")) return "chat"
  }
  if (command.name === "model") return "models"
  if (command.name === "stop" || command.name === "new") return "chat"
  return command.source === "native" ? "chat" : command.source
}

function fuzzyScore(candidate: string, query: string): number {
  const value = candidate.toLowerCase()
  const needle = query.toLowerCase()
  if (!needle) return 1
  if (value === needle) return 100
  if (value.startsWith(needle)) return 80
  if (value.includes(needle)) return 60

  let cursor = 0
  let score = 0
  for (const char of needle) {
    const found = value.indexOf(char, cursor)
    if (found === -1) return 0
    score += found === cursor ? 4 : 1
    cursor = found + 1
  }
  return score
}

// Text a query is matched against for INCLUSION. Only the command's own
// name / native name / explicit aliases — NOT the free-text description or
// category. Matching descriptions with a loose subsequence made typing e.g.
// "/status" surface every command whose description merely contained the
// letters s-t-a-t-u-s in order (and "/sta" matched "/new" via "Start a new
// chat"). Names are what the user is actually typing, so gate on them.
export function commandNameText(command: SlashCommand): string[] {
  return [
    command.name,
    command.nativeName ?? "",
    ...(command.textAliases ?? []),
  ].filter(Boolean)
}

// Kept for callers/tests that want the full searchable surface (name +
// description + category + aliases). Not used for inclusion filtering.
export function commandSearchText(command: SlashCommand): string[] {
  return [
    command.name,
    command.nativeName ?? "",
    command.description,
    command.category ?? "",
    ...(command.textAliases ?? []),
  ].filter(Boolean)
}

export function filterSlashCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  const query = filter.trim().toLowerCase()
  return commands
    .map((command) => {
      // Inclusion is decided ONLY by the command name / native name / aliases.
      // This is what the user is typing after the slash; matching the free
      // description was the source of the "/status shows everything" bug.
      const nameScore = commandNameText(command).reduce(
        (max, text) => Math.max(max, fuzzyScore(text, query)),
        0,
      )
      // A contiguous substring hit in the description is used ONLY as a weak
      // tiebreaker between equal name scores — never to include a command on
      // its own — so intent-ish ranking survives without the old noise.
      const description = (command.description ?? "").toLowerCase()
      const descriptionRank = query.length >= 2 && description.includes(query) ? 1 : 0
      return { command, nameScore, descriptionRank }
    })
    .filter((item) => item.nameScore > 0)
    .sort(
      (a, b) =>
        b.nameScore - a.nameScore ||
        b.descriptionRank - a.descriptionRank ||
        a.command.name.localeCompare(b.command.name),
    )
    .map((item) => item.command)
}

export function groupSlashCommands(commands: SlashCommand[]): CommandGroup[] {
  const groups = new Map<string, SlashCommand[]>()
  for (const command of commands) {
    const id = commandGroup(command)
    groups.set(id, [...(groups.get(id) ?? []), command])
  }
  return Array.from(groups.entries()).map(([id, groupCommands]) => ({
    id,
    label: GROUP_LABELS[id] ?? id,
    commands: groupCommands,
  }))
}

export function clampCommandIndex(index: number, commands: SlashCommand[]) {
  if (commands.length === 0) return 0
  return Math.max(0, Math.min(index, commands.length - 1))
}
