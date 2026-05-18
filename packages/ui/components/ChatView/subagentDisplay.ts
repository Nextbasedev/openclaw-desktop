import { isActiveSubagent } from "@/lib/subagentLifecycle"
import type { SpawnedSubagent } from "./types"

function subagentDisplayKey(sub: SpawnedSubagent) {
  if (sub.sessionKey) return `session:${sub.sessionKey}`
  const label = sub.label.trim().toLowerCase()
  const task = sub.task?.trim().toLowerCase() ?? ""
  return `pending:${label}:${task}`
}

function subagentRank(sub: SpawnedSubagent) {
  let rank = 0
  if (sub.sessionKey) rank += 8
  if (sub.status === "working") rank += 4
  if (sub.status === "completed") rank += 3
  if (sub.status === "linking") rank += 2
  if (sub.status === "spawning") rank += 1
  if (sub.status === "failed") rank += 1
  if (isActiveSubagent(sub.status)) rank += 1
  return rank
}

export function dedupeSubagentsForDisplay(subagents: SpawnedSubagent[]) {
  const byKey = new Map<string, SpawnedSubagent>()

  for (const sub of subagents) {
    const key = subagentDisplayKey(sub)
    const existing = byKey.get(key)
    if (!existing || subagentRank(sub) >= subagentRank(existing)) {
      byKey.set(key, sub)
    }
  }

  const resolvedLabels = new Set<string>()
  for (const sub of byKey.values()) {
    if (!sub.sessionKey) continue
    const label = sub.label.trim().toLowerCase()
    const task = sub.task?.trim().toLowerCase() ?? ""
    resolvedLabels.add(`${label}:${task}`)
  }

  return Array.from(byKey.values()).filter((sub) => {
    if (sub.sessionKey) return true
    const label = sub.label.trim().toLowerCase()
    const task = sub.task?.trim().toLowerCase() ?? ""
    return !resolvedLabels.has(`${label}:${task}`)
  })
}
