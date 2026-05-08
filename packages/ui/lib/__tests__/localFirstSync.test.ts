import { beforeEach, describe, expect, it, vi } from "vitest"

const store = new Map<string, unknown>()

vi.mock("../persistentCache", () => ({
  persistentCacheGet: vi.fn(async (key: string) => store.get(key) ?? null),
  persistentCacheSet: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
  persistentCacheDeletePrefix: vi.fn(async (prefix: string) => {
    for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key)
  }),
}))

const sync = await import("../localFirstSync")

describe("localFirstSync", () => {
  beforeEach(() => store.clear())

  it("stores and retrieves bootstrap state", async () => {
    await sync.localSyncSetBootstrap({ spaces: [{ id: "space_1", name: "P1" } as any], activeSpaceId: "space_1" })
    const result = await sync.localSyncGetBootstrap()
    expect(result?.activeSpaceId).toBe("space_1")
    expect(result?.spaces[0].name).toBe("P1")
  })

  it("stores chats by project/space", async () => {
    await sync.localSyncSetChats("space_1", [{ id: "chat_1", name: "Chat" } as any])
    const result = await sync.localSyncGetChats("space_1")
    expect(result?.chats).toHaveLength(1)
  })

  it("merges messages without duplicating ids", async () => {
    await sync.localSyncSetMessages("s1", [{ messageId: "m1", role: "assistant", text: "hel" } as any])
    await sync.localSyncSetMessages("s1", [{ messageId: "m1", role: "assistant", text: "hello" } as any])
    const result = await sync.localSyncGetMessages("s1")
    expect(result?.messages).toHaveLength(1)
    expect(result?.messages[0].text).toBe("hello")
  })
})
