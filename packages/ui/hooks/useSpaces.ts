"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@/lib/ipc"
import { invalidateMiddlewareStartupBootstrap, loadMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import type { Space } from "@/types/space"

type SpacesResponse = {
  spaces: Space[]
  activeSpaceId: string
}

export function useSpaces() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSpaces = useCallback(async () => {
    setLoading(true)
    try {
      const bootstrap = await loadMiddlewareStartupBootstrap()
      if (bootstrap) {
        setSpaces(bootstrap.spaces || [])
        setActiveSpaceId(bootstrap.activeSpaceId || bootstrap.spaces?.[0]?.id || null)
        return
      }
      const result = await invoke<SpacesResponse>("middleware_spaces_list", { input: {} })
      setSpaces(result.spaces || [])
      setActiveSpaceId(result.activeSpaceId || result.spaces?.[0]?.id || null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  const createSpace = useCallback(async (name?: string) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ space: Space; activeSpaceId: string }>("middleware_spaces_create", {
      input: { name: name?.trim() || undefined },
    })
    invalidateMiddlewareStartupBootstrap()
    await loadSpaces()
    return result.space
  }, [loadSpaces])

  const updateSpace = useCallback(async (spaceId: string, input: { name?: string; repoRoot?: string | null; projectId?: string | null }) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ space: Space }>("middleware_spaces_update", {
      input: { spaceId, ...input },
    })
    invalidateMiddlewareStartupBootstrap()
    await loadSpaces()
    return result.space
  }, [loadSpaces])

  const switchSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    await invoke("middleware_spaces_switch", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setActiveSpaceId(spaceId)
  }, [])

  const deleteSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    const result = await invoke<{ activeSpaceId: string }>("middleware_spaces_delete", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    await loadSpaces()
    setActiveSpaceId(result.activeSpaceId)
    return result.activeSpaceId
  }, [loadSpaces])

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
