import type { SlashCommand } from "@/hooks/useSlashCommands"

const CONTROL_NATIVE_COMMANDS = new Set([
  "status",
  "commands",
  "tools",
  "tasks",
  "context",
  "whoami",
  "session",
  "subagents",
  "acp",
  "focus",
  "unfocus",
  "agents",
  "kill",
  "steer",
  "usage",
  "model",
  "models",
  "reasoning",
  "thinking",
  "verbose",
  "elevated",
  "exec",
  "approve",
  "deny",
  "approvals",
  "help",
  "clear",
  "reset",
  "new",
  "stop",
  "restart",
  "activation",
  "send",
  "compact",
  "think",
  "fast",
  "trace",
  "queue",
])

const FALLBACK_RUN_WHILE_GENERATING = CONTROL_NATIVE_COMMANDS

export function getSlashCommandName(text: string): string | null {
  const match = text.trimStart().match(/^\/(\S+)/)
  return match?.[1]?.toLowerCase() ?? null
}

function commandMatches(command: SlashCommand, name: string) {
  return command.name.toLowerCase() === name
    || command.nativeName?.toLowerCase() === name
    || command.textAliases?.some((alias) => alias.toLowerCase() === name)
}

export function canRunSlashCommandWhileGenerating(
  text: string,
  commands: SlashCommand[],
): boolean {
  const name = getSlashCommandName(text)
  if (!name) return false

  const command = commands.find((entry) => commandMatches(entry, name))
  if (command) {
    return command.scope === "native" || command.scope === "both"
  }

  return FALLBACK_RUN_WHILE_GENERATING.has(name)
}

export function isStopSlashCommand(text: string): boolean {
  return getSlashCommandName(text) === "stop"
}
