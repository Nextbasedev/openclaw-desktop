import { describe, expect, test } from "vitest"
import { warmBootstrapMessages } from "../bootstrapPreview"

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
})
