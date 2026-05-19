import { describe, expect, it } from "vitest"
import { extractSubagentSessionKey, extractSubagentSessionKeys, isSubagentSessionKey } from "./subagentSession"

describe("subagent session key parsing", () => {
  it("accepts subagent keys for any agent id", () => {
    expect(isSubagentSessionKey("agent:main:subagent:abc")).toBe(true)
    expect(isSubagentSessionKey("agent:beta:subagent:abc")).toBe(true)
    expect(isSubagentSessionKey("agent:main:desktop:subagent:abc")).toBe(true)
    expect(extractSubagentSessionKey({ childSessionKey: "agent:main:desktop:subagent:123" })).toBe("agent:main:desktop:subagent:123")
    expect(extractSubagentSessionKeys('spawned agent:beta:subagent:123 and agent:main:desktop:subagent:456')).toEqual([
      "agent:beta:subagent:123",
      "agent:main:desktop:subagent:456",
    ])
  })

  it("accepts fork-style child session keys returned by sessions_spawn", () => {
    expect(isSubagentSessionKey("agent:main:desktop:fork-ca8938df-ee10-43c3-af7f-5f07df3a91cd")).toBe(true)
    expect(isSubagentSessionKey("agent:main:dashboard:8a493656-ed53-43ce-8d96-530be8385340")).toBe(true)
    expect(extractSubagentSessionKey({ childSessionKey: "agent:main:desktop:fork-ca8938df-ee10-43c3-af7f-5f07df3a91cd" })).toBe("agent:main:desktop:fork-ca8938df-ee10-43c3-af7f-5f07df3a91cd")
    expect(extractSubagentSessionKey('{"sessionKey":"agent:main:dashboard:8a493656-ed53-43ce-8d96-530be8385340"}')).toBe("agent:main:dashboard:8a493656-ed53-43ce-8d96-530be8385340")
  })
})
