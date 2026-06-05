import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refs: [] as Array<{ current: unknown }>,
  state: [] as unknown[],
  cursor: 0,
}))

vi.mock("react", () => ({
  useState: vi.fn((initial: unknown) => {
    const slot = mocks.cursor++
    if (mocks.state[slot] === undefined) mocks.state[slot] = initial
    return [
      mocks.state[slot],
      (value: unknown) => {
        mocks.state[slot] = typeof value === "function" ? value(mocks.state[slot]) : value
      },
    ]
  }),
  useRef: vi.fn((initial: unknown) => {
    const slot = mocks.cursor++
    if (!mocks.refs[slot]) mocks.refs[slot] = { current: initial }
    return mocks.refs[slot]
  }),
  useEffect: vi.fn((fn: () => void | (() => void)) => fn()),
}))

vi.mock("@/lib/ipc", () => ({ invoke: mocks.invoke }))

const { useTopicSession } = await import("./useTopicSession")

function renderUseTopicSession(
  activeSessionKey: string | null,
  onSessionResolved: (key: string, title: string) => void,
) {
  mocks.cursor = 0
  return useTopicSession(
    { id: "topic_1", name: "Topic 1", projectId: "project_1", projectName: "Project 1" },
    activeSessionKey,
    onSessionResolved,
  )
}

describe("useTopicSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refs.length = 0
    mocks.state.length = 0
    mocks.cursor = 0
    mocks.invoke.mockResolvedValue({ sessions: [{ key: "session_1", label: "Topic 1", hidden: false }] })
  })

  it("resolves again when the same topic is reselected after its active session was cleared", async () => {
    const onSessionResolved = vi.fn()

    renderUseTopicSession(null, onSessionResolved)
    await vi.waitFor(() => expect(onSessionResolved).toHaveBeenCalledWith("session_1", "Topic 1"))

    renderUseTopicSession("session_1", onSessionResolved)
    renderUseTopicSession(null, onSessionResolved)

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    expect(mocks.invoke).toHaveBeenLastCalledWith("middleware_sessions_list", {
      input: { projectId: "project_1", topicId: "topic_1" },
    })
  })
})
