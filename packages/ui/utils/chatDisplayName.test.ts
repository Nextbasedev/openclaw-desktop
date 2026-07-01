import { describe, expect, it } from "vitest"
import { chatTitleOrFallback, isPendingChatTitle, normalizeChatTitle } from "./chatDisplayName"

describe("chat display title helpers", () => {
  it("normalizes pending chat titles to the shared fallback", () => {
    expect(isPendingChatTitle(null)).toBe(true)
    expect(isPendingChatTitle("Opening chat…")).toBe(true)
    expect(chatTitleOrFallback("Opening chat...")).toBe("New Chat")
  })

  it("trims available chat titles without changing the label", () => {
    expect(isPendingChatTitle("  HELLO  ")).toBe(false)
    expect(normalizeChatTitle("  HELLO  ")).toBe("HELLO")
  })
})
