import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat } from "@/types/chat"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  loadMiddlewareStartupBootstrap: vi.fn(),
  localSyncGetChats: vi.fn(),
  localSyncSetChats: vi.fn(),
  localSyncSubscribeChats: vi.fn(),
  persistentCacheGet: vi.fn(),
  persistentCacheSet: vi.fn(),
  stateSets: [] as unknown[][],
}))

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: vi.fn((initial: unknown) => {
    const slot = mocks.stateSets.length
    mocks.stateSets.push([initial])
    return [
      initial,
      (value: unknown) => {
        mocks.stateSets[slot].push(value)
      },
    ]
  }),
  useEffect: vi.fn(),
  useCallback: vi.fn((fn: unknown) => fn),
  useMemo: vi.fn((fn: () => unknown) => fn()),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
}))

vi.mock("@/lib/ipc", () => ({ invoke: mocks.invoke }))
vi.mock("@/lib/events", () => ({ on: vi.fn(), emit: vi.fn() }))
vi.mock("@/lib/localFirstSync", () => ({
  localSyncGetChats: mocks.localSyncGetChats,
  localSyncSetChats: mocks.localSyncSetChats,
  localSyncSubscribeChats: mocks.localSyncSubscribeChats,
}))
vi.mock("@/lib/persistentCache", () => ({
  persistentCacheGet: mocks.persistentCacheGet,
  persistentCacheSet: mocks.persistentCacheSet,
}))
vi.mock("@/lib/startupBootstrap", () => ({
  invalidateMiddlewareStartupBootstrap: vi.fn(),
  loadMiddlewareStartupBootstrap: mocks.loadMiddlewareStartupBootstrap,
}))
vi.mock("@/lib/middleware-client", () => ({
  MIDDLEWARE_CONNECTION_CHANGED_EVENT: "middleware-connection-changed",
}))

const { clearDedupeForTests } = await import("@/lib/requestDedupe")
const { useChatsData } = await import("./index")

describe("useChatsData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateSets.length = 0
    clearDedupeForTests()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "jarvis.gatewayActive" ? "true" : null),
    })
    mocks.persistentCacheGet.mockResolvedValue(null)
    mocks.localSyncSetChats.mockResolvedValue(undefined)
    mocks.persistentCacheSet.mockResolvedValue(undefined)
    mocks.localSyncSubscribeChats.mockReturnValue(() => {})
  })

  it("falls through to middleware chats when local/bootstrap data has an empty chat list", async () => {
    const backendChat: Chat = {
      id: "chat_backend",
      name: "Backend chat",
      spaceId: "space_1",
      agentId: "main",
      archived: false,
      pinned: false,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    }

    mocks.localSyncGetChats.mockResolvedValue({ spaceId: "space_1", chats: [], updatedAt: Date.now() })
    mocks.loadMiddlewareStartupBootstrap.mockResolvedValue({
      spaces: [{ id: "space_1", name: "Space 1" }],
      activeSpaceId: "space_1",
      chats: [],
    })
    mocks.invoke.mockResolvedValue({ chats: [backendChat] })

    const data = useChatsData(null, vi.fn(), 0, "space_1")
    await data.loadChats()

    expect(mocks.invoke).toHaveBeenCalledWith("middleware_chats_list", {
      input: { spaceId: "space_1" },
    })
    expect(mocks.stateSets[0]).toContainEqual([backendChat])
    expect(mocks.localSyncSetChats).toHaveBeenCalledWith("space_1", [backendChat], undefined, expect.any(Number))
  })

  it("does not fetch all chats while active space is unresolved", async () => {
    const cachedChat: Chat = {
      id: "chat_cached",
      name: "Cached chat",
      spaceId: "space_1",
      agentId: "main",
      archived: false,
      pinned: false,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    }

    mocks.loadMiddlewareStartupBootstrap.mockResolvedValue({
      spaces: [{ id: "space_1", name: "Space 1" }],
      activeSpaceId: "space_1",
      chats: [cachedChat],
    })

    const data = useChatsData(null, vi.fn(), 0, null)
    await data.loadChats()

    expect(mocks.invoke).not.toHaveBeenCalledWith("middleware_chats_list", expect.anything())
    expect(mocks.stateSets[0]).toContainEqual([cachedChat])
  })

  it("loads archived chats globally instead of scoping archive to the active space", async () => {
    const archivedChat: Chat = {
      id: "chat_archived_other_space",
      name: "Archived other space chat",
      spaceId: "space_2",
      agentId: "main",
      archived: true,
      pinned: false,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    }

    mocks.invoke.mockResolvedValue({ chats: [archivedChat] })

    const data = useChatsData(null, vi.fn(), 0, "space_1", true)
    await data.loadChats()

    expect(mocks.invoke).toHaveBeenCalledWith("middleware_chats_list", {
      input: { archived: true },
    })
    expect(mocks.stateSets[0]).toContainEqual([archivedChat])
  })

  it("only writes chats for the captured request space to cache", async () => {
    const spaceOneChat: Chat = {
      id: "chat_space_1",
      name: "Space 1 chat",
      spaceId: "space_1",
      agentId: "main",
      archived: false,
      pinned: false,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    }
    const spaceTwoChat: Chat = {
      id: "chat_space_2",
      name: "Space 2 chat",
      spaceId: "space_2",
      agentId: "main",
      archived: false,
      pinned: false,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    }

    mocks.localSyncGetChats.mockResolvedValue(null)
    mocks.loadMiddlewareStartupBootstrap.mockResolvedValue(null)
    mocks.invoke.mockResolvedValue({ chats: [spaceOneChat, spaceTwoChat] })

    const data = useChatsData(null, vi.fn(), 0, "space_1")
    await data.loadChats()

    expect(mocks.persistentCacheSet).toHaveBeenCalledWith(
      "project:space_1:chats",
      [spaceOneChat],
      expect.any(Object),
    )
    expect(mocks.localSyncSetChats).toHaveBeenCalledWith("space_1", [spaceOneChat], undefined, expect.any(Number))
    expect(mocks.localSyncSetChats).not.toHaveBeenCalledWith("space_1", [spaceOneChat, spaceTwoChat], undefined, expect.any(Number))
  })
})
