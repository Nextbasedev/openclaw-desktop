import { afterEach, describe, expect, it } from "vitest"
import { persistentCacheClearAll } from "../persistentCache"
import { getWarmChatCache, setWarmChatCache, WARM_CHAT_MAX_MESSAGES } from "../warmChatCache"

afterEach(async () => {
  await persistentCacheClearAll()
})

describe("warmChatCache", () => {
  it("stores only the latest 60 messages for fast chat loading", async () => {
    const messages = Array.from({ length: WARM_CHAT_MAX_MESSAGES + 5 }, (_, index) => ({
      messageId: `m${index}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message ${index}`,
    }))

    await setWarmChatCache("s1", { messages })
    const cached = await getWarmChatCache("s1")

    expect(WARM_CHAT_MAX_MESSAGES).toBe(60)
    expect(cached?.entry.messages).toHaveLength(60)
    expect(cached?.entry.messages[0]?.messageId).toBe("m5")
    expect(cached?.entry.messages.at(-1)?.messageId).toBe("m64")
  })
})
