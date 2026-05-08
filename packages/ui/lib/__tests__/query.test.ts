import { describe, expect, it, vi } from "vitest"
import { createOpenClawQueryClient, queryKeys, queryStaleTime } from "../query"

describe("OpenClaw query cache", () => {
  it("dedupes concurrent chat bootstrap reads by session key", async () => {
    const client = createOpenClawQueryClient()
    const fn = vi.fn(async () => ({ ok: true }))

    await Promise.all([
      client.fetchQuery({
        queryKey: queryKeys.chatBootstrap("agent:main:a"),
        queryFn: fn,
        staleTime: queryStaleTime.chatBootstrap,
      }),
      client.fetchQuery({
        queryKey: queryKeys.chatBootstrap("agent:main:a"),
        queryFn: fn,
        staleTime: queryStaleTime.chatBootstrap,
      }),
    ])

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("keeps different chat sessions isolated", async () => {
    const client = createOpenClawQueryClient()
    const fn = vi.fn(async (sessionKey: string) => ({ sessionKey }))

    await Promise.all([
      client.fetchQuery({
        queryKey: queryKeys.chatBootstrap("agent:main:a"),
        queryFn: () => fn("agent:main:a"),
        staleTime: queryStaleTime.chatBootstrap,
      }),
      client.fetchQuery({
        queryKey: queryKeys.chatBootstrap("agent:main:b"),
        queryFn: () => fn("agent:main:b"),
        staleTime: queryStaleTime.chatBootstrap,
      }),
    ])

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("invalidates sessions independently from chat bootstrap", async () => {
    const client = createOpenClawQueryClient()
    client.setQueryData(queryKeys.sessions(), { sessions: [] })
    client.setQueryData(queryKeys.chatBootstrap("agent:main:a"), { history: {} })

    await client.invalidateQueries({ queryKey: queryKeys.sessions() })

    expect(client.getQueryData(queryKeys.chatBootstrap("agent:main:a"))).toEqual({ history: {} })
  })
})
