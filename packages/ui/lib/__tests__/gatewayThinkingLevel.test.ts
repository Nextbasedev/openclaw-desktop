import { describe, expect, test } from "vitest"
import { latestGatewayThinkingLevel } from "../gatewayThinkingLevel"

describe("latestGatewayThinkingLevel", () => {
  test("uses the latest /think reply from the current session transcript", () => {
    expect(latestGatewayThinkingLevel([
      { role: "assistant", text: "Current thinking level: low.\nOptions: off, minimal, low, medium, high." },
      { role: "user", text: "/think" },
      { role: "assistant", text: "Current thinking level: medium.\nOptions: off, minimal, low, medium, high." },
    ])).toBe("medium")
  })

  test("reads the effective level from a Gateway /status reply", () => {
    expect(latestGatewayThinkingLevel([
      { role: "assistant", text: "⚙️ Runtime: direct · Runner: pi (embedded) · Think: high · Text: low" },
    ])).toBe("high")
  })

  test("does not treat unrelated assistant text as a thinking setting", () => {
    expect(latestGatewayThinkingLevel([
      { role: "assistant", text: "I think this is ready." },
    ])).toBeNull()
  })
})
