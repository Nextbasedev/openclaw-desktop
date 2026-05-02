import { describe, expect, it } from "vitest"
import { extractSubagentSessionKey, extractSubagentSessionKeys, isSubagentSessionKey } from "./subagentSession"

describe("subagent session key parsing", () => {
  it("accepts subagent keys for any agent id", () => {
    expect(isSubagentSessionKey("agent:main:subagent:abc")).toBe(true)
    expect(isSubagentSessionKey("agent:beta:subagent:abc")).toBe(true)
    expect(extractSubagentSessionKey({ childSessionKey: "agent:beta:subagent:123" })).toBe("agent:beta:subagent:123")
    expect(extractSubagentSessionKeys('spawned agent:beta:subagent:123 and agent:main:subagent:456')).toEqual([
      "agent:beta:subagent:123",
      "agent:main:subagent:456",
    ])
  })
})
