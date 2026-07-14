import { afterEach, describe, expect, it } from "vitest"
import { persistentCacheClearAll } from "../persistentCache"
import { getWarmChatCache, setWarmChatCache, WARM_CHAT_MAX_MESSAGES } from "../warmChatCache"

afterEach(async () => {
  await persistentCacheClearAll()
})

describe("warmChatCache", () => {
  it("keeps full warm-cache histories without a fixed message-count window", async () => {
    const total = 25
    const messages = Array.from({ length: total }, (_, index) => ({
      messageId: `m${index}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message ${index}`,
    }))

    await setWarmChatCache("s1", { messages })
    const cached = await getWarmChatCache("s1")

    expect(WARM_CHAT_MAX_MESSAGES).toBe(Number.MAX_SAFE_INTEGER)
    expect(cached?.entry.messages).toHaveLength(total)
    expect(cached?.entry.messages[0]?.messageId).toBe("m0")
    expect(cached?.entry.messages.at(-1)?.messageId).toBe(`m${total - 1}`)
  })

  it("does not replace long visible message text with a truncated preview", async () => {
    const longText = `${"Long assistant response. ".repeat(8_000)}THE_REAL_END`

    await setWarmChatCache("s1", {
      messages: [{ messageId: "m1", role: "assistant", text: longText }],
    })
    const cached = await getWarmChatCache("s1")

    expect(cached?.entry.messages[0]?.text).toBe(longText)
    expect(cached?.entry.messages[0]?.text).toContain("THE_REAL_END")
    expect(cached?.entry.messages[0]?.text).not.toContain("Cached preview truncated")
  })
})
