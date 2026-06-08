import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { normalizeSessionTokenUsage } from "./sessionContextUsage"

describe("normalizeSessionTokenUsage", () => {
  it("keeps live session context API values exactly", () => {
    assert.deepEqual(
      normalizeSessionTokenUsage({
        input: 4_200,
        output: 270,
        cacheRead: 138_000,
        cacheWrite: 0,
        totalCacheRead: 151_000,
        total: 139_000,
        cost: null,
        contextLimit: 400_000,
      }),
      {
        input: 4_200,
        output: 270,
        cacheRead: 138_000,
        cacheWrite: 0,
        totalCacheRead: 151_000,
        total: 139_000,
        cost: null,
        contextLimit: 400_000,
      }
    )
  })

  it("does not invent a context total when the API has no usage yet", () => {
    assert.equal(normalizeSessionTokenUsage(null), null)
    assert.equal(normalizeSessionTokenUsage({ input: 0, output: 0, total: 0 }), null)
  })
})
