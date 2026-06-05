import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
  loadMiddlewareStartupBootstrap: vi.fn(),
  invalidateMiddlewareStartupBootstrap: vi.fn(),
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
        mocks.stateSets[slot].push(typeof value === "function" ? value(mocks.stateSets[slot].at(-1)) : value)
      },
    ]
  }),
  useEffect: vi.fn(),
  useCallback: vi.fn((fn: unknown) => fn),
  useMemo: vi.fn((fn: () => unknown) => fn()),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
}))

vi.mock("@/lib/ipc", () => ({ invoke: mocks.invoke }))
vi.mock("@/lib/events", () => ({ on: mocks.on, emit: mocks.emit }))
vi.mock("@/lib/toast", () => ({ checkGatewayOrRedirect: vi.fn(async () => true) }))
vi.mock("@/lib/middleware-client", () => ({
  MIDDLEWARE_CONNECTION_CHANGED_EVENT: "middleware-connection-changed",
}))
vi.mock("@/lib/startupBootstrap", () => ({
  invalidateMiddlewareStartupBootstrap: mocks.invalidateMiddlewareStartupBootstrap,
  loadMiddlewareStartupBootstrap: mocks.loadMiddlewareStartupBootstrap,
}))
vi.mock("@/lib/sidebarOrderCache", () => ({
  loadSidebarOrder: vi.fn(async () => []),
  saveSidebarOrder: vi.fn(async () => undefined),
}))

const { useProjectsData } = await import("./index")

describe("useProjectsData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateSets.length = 0
    mocks.loadMiddlewareStartupBootstrap.mockResolvedValue(null)
    mocks.invoke.mockResolvedValue({ projects: [], topics: [] })
  })

  it("force-refreshes project topics when expanding a project", async () => {
    const data = useProjectsData(vi.fn(), null, vi.fn(), "space_1")

    data.handleProjectClick({ id: "project_1", name: "Project 1", archived: false })
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("middleware_topics_list", {
        input: { projectId: "project_1" },
      })
    })
  })

  it("clears the active topic when archiving its project", async () => {
    const onTopicClear = vi.fn()
    const data = useProjectsData(
      vi.fn(),
      { id: "topic_1", name: "Topic 1", projectId: "project_1", projectName: "Project 1" },
      onTopicClear,
      "space_1",
    )

    await data.handleArchiveProject("project_1")

    expect(mocks.invalidateMiddlewareStartupBootstrap).toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith("middleware_projects_archive", {
      input: { projectId: "project_1" },
    })
    expect(onTopicClear).toHaveBeenCalled()
    expect(mocks.emit).toHaveBeenCalledWith("archive:changed")
  })
})
