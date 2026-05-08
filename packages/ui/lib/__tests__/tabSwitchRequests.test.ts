import { afterEach, describe, expect, it, vi } from "vitest"
import { clearDedupeForTests, dedupeRequest, invalidateDedupe } from "../requestDedupe"

afterEach(() => clearDedupeForTests())

describe("tab switch request burst dedupe", () => {
  it("switching between two cached chat tabs does not refetch same chat bootstrap within ttl", async () => {
    const fetchBootstrap = vi.fn(async (sessionKey: string) => ({ sessionKey }))
    await dedupeRequest("chat-bootstrap:agent:main:a", () => fetchBootstrap("agent:main:a"), { ttlMs: 5000 })
    await dedupeRequest("chat-bootstrap:agent:main:b", () => fetchBootstrap("agent:main:b"), { ttlMs: 5000 })
    await dedupeRequest("chat-bootstrap:agent:main:a", () => fetchBootstrap("agent:main:a"), { ttlMs: 5000 })
    expect(fetchBootstrap).toHaveBeenCalledTimes(2)
  })

  it("mounting two ChatBoxes shares one voice settings request", async () => {
    const fetchVoice = vi.fn(async () => ({ settings: { provider: "openai" } }))
    const first = dedupeRequest("voice-settings", fetchVoice, { ttlMs: 30_000 })
    const second = dedupeRequest("voice-settings", fetchVoice, { ttlMs: 30_000 })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetchVoice).toHaveBeenCalledTimes(1)
  })

  it("switching to usage tab dedupes usage requests for the same period", async () => {
    const fetchUsage = vi.fn(async (days: number) => ({ days }))
    await Promise.all([
      dedupeRequest("usage:7", () => fetchUsage(7), { ttlMs: 30_000 }),
      dedupeRequest("usage:7", () => fetchUsage(7), { ttlMs: 30_000 }),
    ])
    expect(fetchUsage).toHaveBeenCalledTimes(1)
  })

  it("workspace focus refresh dedupes same path tree request", async () => {
    const fetchTree = vi.fn(async (path: string) => ({ entries: [path] }))
    await Promise.all([
      dedupeRequest("workspace-tree:p1:agent:main:a:/", () => fetchTree("/")),
      dedupeRequest("workspace-tree:p1:agent:main:a:/", () => fetchTree("/")),
    ])
    expect(fetchTree).toHaveBeenCalledTimes(1)
  })

  it("invalidating a prefix forces the next tab switch read to refetch", async () => {
    const fetchVoice = vi.fn(async () => ({ ok: true }))
    await dedupeRequest("voice-settings", fetchVoice, { ttlMs: 30_000 })
    invalidateDedupe("voice-settings")
    await dedupeRequest("voice-settings", fetchVoice, { ttlMs: 30_000 })
    expect(fetchVoice).toHaveBeenCalledTimes(2)
  })
})
