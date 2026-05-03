import assert from "node:assert/strict"
import {
  clampCommandIndex,
  filterSlashCommands,
  groupSlashCommands,
} from "../../packages/ui/lib/slashCommandFilter"
import type { SlashCommand } from "../../packages/ui/hooks/useSlashCommands"

const commands: SlashCommand[] = [
  {
    name: "review",
    textAliases: ["critique", "inspect"],
    description: "Review code",
    category: "chat",
    source: "native",
    scope: "text",
    acceptsArgs: true,
  },
  {
    name: "model",
    description: "Switch model",
    category: "models",
    source: "native",
    scope: "text",
    acceptsArgs: true,
  },
  {
    name: "deploy",
    description: "Deploy with a skill",
    category: "skills",
    source: "skill",
    scope: "text",
    acceptsArgs: true,
  },
]

assert.equal(filterSlashCommands(commands, "crit")[0].name, "review")
assert.equal(filterSlashCommands(commands, "mdl")[0].name, "model")
assert.equal(clampCommandIndex(99, commands), 2)
assert.equal(clampCommandIndex(-1, commands), 0)

const groups = groupSlashCommands(commands)
assert.ok(groups.some((group) => group.label === "Chat"))
assert.ok(groups.some((group) => group.label === "Models"))
assert.ok(groups.some((group) => group.label === "Skills"))

console.log("slash command checks passed")
