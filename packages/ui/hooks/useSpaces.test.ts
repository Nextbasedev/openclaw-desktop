import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  stateSets: [] as unknown[][],
  effects: [] as Array<() => unknown>,
}))

vi.mock("react", () => ({
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
  useEffect: vi.fn((fn: () => unknown) => {
    mocks.effects.push(fn)
  }),
  useCallback: vi.fn((fn: unknown) => fn),
}))

vi.mock("@/lib/ipc", () => ({ invoke: mocks.invoke }))
vi.mock("@/lib/middleware-client", () => ({
  MIDDLEWARE_CONNECTION_CHANGED_EVENT: "middleware-connection-changed",
}))
vi.mock("@/lib/startupBootstrap", () => ({
  invalidateMiddlewareStartupBootstrap: vi.fn(),
}))

const { useSpaces } = await import("./useSpaces")

describe("useSpaces", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateSets.length = 0
    mocks.effects.length = 0
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  it("loads spaces directly from the middleware API as source of truth", async () => {
    mocks.invoke.mockResolvedValue({
      spaces: [{ id: "space_new", name: "New" }],
      activeSpaceId: "space_new",
    })

    const data = useSpaces()
    await data.loadSpaces()

    expect(mocks.invoke).toHaveBeenCalledWith("middleware_spaces_list", { input: {} })
    expect(mocks.stateSets[0]).toContainEqual([{ id: "space_new", name: "New" }])
    expect(mocks.stateSets[1]).toContain("space_new")
  })
})
