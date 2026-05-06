"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@/lib/ipc"
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
    const result = await invoke<{ space: Space; activeSpaceId: string }>("middleware_spaces_create", {
      input: { name: name?.trim() || undefined },
    })
    await loadSpaces()
    return result.space
  }, [loadSpaces])

  const updateSpace = useCallback(async (spaceId: string, input: { name?: string; repoRoot?: string | null; projectId?: string | null }) => {
    const result = await invoke<{ space: Space }>("middleware_spaces_update", {
      input: { spaceId, ...input },
    })
    await loadSpaces()
    return result.space
  }, [loadSpaces])

  const switchSpace = useCallback(async (spaceId: string) => {
    await invoke("middleware_spaces_switch", { input: { spaceId } })
    setActiveSpaceId(spaceId)
  }, [])

  const deleteSpace = useCallback(async (spaceId: string) => {
    const result = await invoke<{ activeSpaceId: string }>("middleware_spaces_delete", { input: { spaceId } })
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
