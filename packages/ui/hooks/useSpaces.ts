"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@/lib/ipc"
import { on } from "@/lib/events"
import { localSyncSubscribeBootstrap } from "@/lib/localFirstSync"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import { renameSpace } from "@/lib/api/spaces"
import {
  invalidateMiddlewareStartupBootstrap,
  loadMiddlewareStartupBootstrap,
} from "@/lib/startupBootstrap"
import type { Space } from "@/types/space"

type SpacesResponse = {
  spaces: Space[]
  activeSpaceId: string
}

function upsertSpace(spaces: Space[], nextSpace: Space) {
  if (!nextSpace?.id) return spaces
  const found = spaces.some((space) => space.id === nextSpace.id)
  const next = found
    ? spaces.map((space) => space.id === nextSpace.id ? nextSpace : space)
    : [...spaces, nextSpace]
  return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

type SpaceMutationResponse = {
  ok?: boolean
  space?: Space
  activeSpaceId?: string
}

const DEFAULT_SPACE_ID = "space_default"
const DEFAULT_SPACE_NAME = "My Workspace"

function normalizeSpaces(spaces: Space[] = []) {
  return spaces.map((space) =>
    space.id === DEFAULT_SPACE_ID
      ? { ...space, name: DEFAULT_SPACE_NAME, archived: false }
      : space,
  )
}

export function useSpaces() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSpacesFresh = useCallback(async () => {
    const result = await invoke<SpacesResponse>("middleware_spaces_list", { input: {} })
    const nextSpaces = normalizeSpaces(result.spaces || [])
    setSpaces(nextSpaces)
    setActiveSpaceId(result.activeSpaceId || nextSpaces[0]?.id || null)
    return result
  }, [])

  const loadSpaces = useCallback(async () => {
    setLoading(true)
    try {
      const bootstrap = await loadMiddlewareStartupBootstrap()
      if (bootstrap) {
        setSpaces(normalizeSpaces(bootstrap.spaces || []))
        setActiveSpaceId(bootstrap.activeSpaceId || bootstrap.spaces?.[0]?.id || null)
      }
      await loadSpacesFresh()
    } finally {
      setLoading(false)
    }
  }, [loadSpacesFresh])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  useEffect(() => {
    return localSyncSubscribeBootstrap((bootstrap) => {
      setSpaces(normalizeSpaces(bootstrap.spaces || []))
      setActiveSpaceId(bootstrap.activeSpaceId || bootstrap.spaces?.[0]?.id || null)
    })
  }, [])

  useEffect(() => {
    function handleConnectionChanged() {
      invalidateMiddlewareStartupBootstrap()
      setSpaces([])
      setActiveSpaceId(null)
      setLoading(true)
      void loadSpacesFresh().finally(() => setLoading(false))
    }

    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, handleConnectionChanged)
    return () =>
      window.removeEventListener(
        MIDDLEWARE_CONNECTION_CHANGED_EVENT,
        handleConnectionChanged,
      )
  }, [loadSpacesFresh])

  useEffect(() => on("archive:changed", loadSpacesFresh), [loadSpacesFresh])

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
    const optimisticUpdatedAt = new Date().toISOString()
    const optimisticPatch = {
      ...input,
      repoRoot: input.repoRoot ?? undefined,
      projectId: input.projectId ?? undefined,
    }
    setSpaces((prev) =>
      prev.map((space) =>
        space.id === spaceId
          ? {
              ...space,
              ...optimisticPatch,
              updatedAt: optimisticUpdatedAt,
            }
          : space,
      ),
    )
    const isRenameOnly = Boolean(input.name) && input.repoRoot === undefined && input.projectId === undefined
    const result = isRenameOnly
      ? await renameSpace(spaceId, input.name!.trim())
      : await invoke<SpaceMutationResponse>("middleware_spaces_update", {
          input: { spaceId, ...input },
        })
    invalidateMiddlewareStartupBootstrap()
    if (result.space) {
      setSpaces((prev) => upsertSpace(prev, result.space as Space))
    }
    const fresh = await loadSpacesFresh().catch((error) => {
      console.error("[Spaces] refresh after update failed", error)
      return null
    })
    return (
      fresh?.spaces?.find((space) => space.id === spaceId) ??
      result.space ??
      null
    )
  }, [loadSpacesFresh])

  const switchSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    await invoke("middleware_spaces_switch", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setActiveSpaceId(spaceId)
    void loadSpacesFresh().catch((error) => console.error("[Spaces] refresh after switch failed", error))
  }, [loadSpacesFresh])

  const archiveSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    await invoke<{ ok: true; activeSpaceId?: string }>("middleware_spaces_archive", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => prev.filter((space) => space.id !== spaceId))
    const result = await loadSpacesFresh()
    return result.activeSpaceId
  }, [loadSpacesFresh])

  const deleteSpace = useCallback(async (spaceId: string) => {
    invalidateMiddlewareStartupBootstrap()
    await invoke<{ ok: true; activeSpaceId?: string }>("middleware_spaces_delete", { input: { spaceId } })
    invalidateMiddlewareStartupBootstrap()
    setSpaces((prev) => prev.filter((space) => space.id !== spaceId))
    const result = await loadSpacesFresh()
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
    archiveSpace,
    switchSpace,
    deleteSpace,
  }
}
