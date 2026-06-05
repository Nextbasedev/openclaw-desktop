import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchChatToolDetailV2 = vi.fn()

vi.mock("@/lib/chat-engine-v2/client", () => ({
  fetchChatToolDetailV2: (...args: unknown[]) => fetchChatToolDetailV2(...args),
}))

import {
  clearToolDetailCachesForTest,
  fetchToolDetailsWithInflightDedupe,
} from "@/components/ChatView/ToolCallSteps"

describe("ToolCallSteps tool-detail hydration", () => {
  beforeEach(() => {
    clearToolDetailCachesForTest()
    fetchChatToolDetailV2.mockReset()
  })

  it("reuses an in-flight request for the same session and sorted id set", async () => {
    fetchChatToolDetailV2.mockResolvedValue({
      tools: [
        { toolCallId: "a", name: "read", status: "success" },
        { toolCallId: "b", name: "write", status: "success" },
      ],
    })

    const [first, second] = await Promise.all([
      fetchToolDetailsWithInflightDedupe("session-1", ["b", "a"]),
      fetchToolDetailsWithInflightDedupe("session-1", ["a", "b"]),
    ])

    expect(fetchChatToolDetailV2).toHaveBeenCalledTimes(1)
    expect(fetchChatToolDetailV2).toHaveBeenCalledWith({ sessionKey: "session-1", ids: ["a", "b"] })
    expect(first.a?.name).toBe("read")
    expect(second.b?.name).toBe("write")
  })
})
