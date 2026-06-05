import { describe, expect, it } from "vitest"

import { formatToolStepSummary, isSubagentToolName } from "./toolStepLabel"

describe("tool step labels", () => {
  it("labels displayed tools compactly", () => {
    expect(formatToolStepSummary(1)).toBe("1 tool")
    expect(formatToolStepSummary(3)).toBe("3 tools")
  })

  it("reconciles hidden subagent tool calls", () => {
    expect(formatToolStepSummary(31, 1)).toBe("31 tools (+1 subagent)")
    expect(formatToolStepSummary(31, 27)).toBe("31 tools (+27 subagents)")
  })

  it("recognizes hidden subagent tool names", () => {
    expect(isSubagentToolName("sessions_spawn")).toBe(true)
    expect(isSubagentToolName("subagents")).toBe(true)
    expect(isSubagentToolName("sessions_yield")).toBe(true)
    expect(isSubagentToolName("exec")).toBe(false)
  })
})
