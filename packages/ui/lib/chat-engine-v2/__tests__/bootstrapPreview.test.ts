import { describe, expect, test } from "vitest"
import { createOpenClawQueryClient, queryKeys } from "../../query"
import { updateCachedBootstrapMessages, warmBootstrapMessages } from "../bootstrapPreview"

describe("warmBootstrapMessages", () => {
  test("uses initial messages first", () => {
    expect(warmBootstrapMessages([{ messageId: "initial", role: "user", text: "hi" }], null)?.[0]).toMatchObject({ messageId: "initial" })
  })

  test("uses fresh cached bootstrap messages to avoid tab-switch empty reload", () => {
    const warm = warmBootstrapMessages(undefined, {
      history: { messages: [{ role: "assistant", text: "cached answer", __openclaw: { id: "a1", seq: 1 } }] },
    })
    expect(warm).toHaveLength(1)
    expect(warm?.[0]).toMatchObject({ messageId: "a1", role: "assistant", text: "cached answer" })
  })

  test("returns undefined when there is no warm source", () => {
    expect(warmBootstrapMessages(undefined, null)).toBeUndefined()
  })

  test("updates in-memory bootstrap cache from live message changes", () => {
    const client = createOpenClawQueryClient()
    client.setQueryData(queryKeys.chatBootstrap("s1"), {
      history: { messages: [], sessionStatus: "running" },
      branchData: { branches: [] },
      v2Cursor: 12,
    })

    updateCachedBootstrapMessages(client, "s1", [
      { messageId: "u1", role: "user", text: "sent while tab is open" },
    ])

    const cached = client.getQueryData(queryKeys.chatBootstrap("s1")) as { history: { messages: unknown[]; sessionStatus?: string }, v2Cursor?: number }
    expect(cached.history.messages).toMatchObject([{ messageId: "u1", text: "sent while tab is open" }])
    expect(cached.history.sessionStatus).toBe("running")
    expect(cached.v2Cursor).toBe(12)
  })
})
