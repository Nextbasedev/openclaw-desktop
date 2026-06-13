import { afterEach, describe, expect, it } from "vitest"
import { persistentCacheClearAll } from "../persistentCache"
import { getWarmChatCache, setWarmChatCache, WARM_CHAT_MAX_MESSAGES } from "../warmChatCache"

afterEach(async () => {
  await persistentCacheClearAll()
})

describe("warmChatCache", () => {
  it("stores only the latest WARM_CHAT_MAX_MESSAGES messages for fast chat loading", async () => {
    const extra = 5
    const total = WARM_CHAT_MAX_MESSAGES + extra
    const messages = Array.from({ length: total }, (_, index) => ({
      messageId: `m${index}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message ${index}`,
    }))

    await setWarmChatCache("s1", { messages })
    const cached = await getWarmChatCache("s1")

    // Aligned to CHAT_BOOTSTRAP_MESSAGE_LIMIT so the reload first paint
    // matches a sidebar session click — no "count shrinks then grows".
    expect(WARM_CHAT_MAX_MESSAGES).toBe(200)
    expect(cached?.entry.messages).toHaveLength(WARM_CHAT_MAX_MESSAGES)
    expect(cached?.entry.messages[0]?.messageId).toBe(`m${extra}`)
    expect(cached?.entry.messages.at(-1)?.messageId).toBe(`m${total - 1}`)
  })
})
