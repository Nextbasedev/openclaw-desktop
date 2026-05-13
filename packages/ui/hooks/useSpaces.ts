"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@/lib/ipc"
import { invalidateMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import type { Space } from "@/types/space"

type SpacesResponse = {
  spaces: Space[]
  activeSpaceId: string
}

function upsertSpace(spaces: Space[], nextSpace: Space) {
  const found = spaces.some((space) => space.id === nextSpace.id)
  const next = found
    ? spaces.map((space) => space.id === nextSpace.id ? nextSpace : space)
    : [...spaces, nextSpace]
  return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

export function useSpaces() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSpacesFresh = useCallback(async () => {
    const result = await invoke<SpacesResponse>("middleware_spaces_list", { input: {} })
    const nextSpaces = result.spaces || []
    setSpaces(nextSpaces)
    setActiveSpaceId(result.activeSpaceId || nextSpaces[0]?.id || null)
    return result
  }, [])

  const loadSpaces = useCallback(async () => {
    setLoading(true)
    try {
      await loadSpacesFresh()
    } finally {
      setLoading(false)
    }
  }, [loadSpacesFresh])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  const createSpace = useCallback(async (name?: string) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ space: Space; activeSpaceId: string }>("middleware_spaces_create", {
      input: { name: name?.trim() || undefined },
    })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => upsertSpace(prev, result.space))
    setActiveSpaceId(result.activeSpaceId || result.space.id)
    void loadSpacesFresh().catch((error) => console.error("[Spaces] refresh after create failed", error))
    return result.space
  }, [loadSpacesFresh])

  const updateSpace = useCallback(async (spaceId: string, input: { name?: string; repoRoot?: string | null; projectId?: string | null }) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ space: Space }>("middleware_spaces_update", {
      input: { spaceId, ...input },
    })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => upsertSpace(prev, result.space))
    void loadSpacesFresh().catch((error) => console.error("[Spaces] refresh after update failed", error))
    return result.space
  }, [loadSpacesFresh])

  const switchSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    await invoke("middleware_spaces_switch", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setActiveSpaceId(spaceId)
    void loadSpacesFresh().catch((error) => console.error("[Spaces] refresh after switch failed", error))
  }, [loadSpacesFresh])

  const deleteSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ activeSpaceId: string }>("middleware_spaces_delete", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => prev.filter((space) => space.id !== spaceId))
    setActiveSpaceId(result.activeSpaceId)
    void loadSpacesFresh().catch((error) => console.error("[Spaces] refresh after delete failed", error))
    return result.activeSpaceId
  }, [loadSpacesFresh])

  return {
    spaces,
    activeSpaceId,
    activeSpace: spaces.find((space) => space.id === activeSpaceId) ?? null,
    loading,
    loadSpaces,
    createSpace,
    updateSpace,
    switchSpace,
    deleteSpace,
  }
}
