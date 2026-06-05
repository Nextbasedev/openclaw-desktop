import { describe, expect, it } from "vitest"
import { CHAT_OLDER_PAGE_LIMIT } from "@/hooks/useChatMessages"

describe("CHAT_OLDER_PAGE_LIMIT", () => {
  it("keeps older-history pages small enough for smooth prefetching", () => {
    expect(CHAT_OLDER_PAGE_LIMIT).toBe(50)
  })
})
