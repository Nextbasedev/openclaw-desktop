export function formatToolStepSummary(displayedToolCount: number, hiddenSubagentToolCount = 0) {
  const toolsLabel = `${displayedToolCount} tool${displayedToolCount === 1 ? "" : "s"}`
  if (hiddenSubagentToolCount <= 0) return toolsLabel
  return `${toolsLabel} (+${hiddenSubagentToolCount} subagent${hiddenSubagentToolCount === 1 ? "" : "s"})`
}

export function isSubagentToolName(tool: string | null | undefined) {
  return tool === "sessions_spawn" || tool === "subagents" || tool === "sessions_yield"
}
