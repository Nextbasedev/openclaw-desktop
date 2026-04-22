"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { invoke } from "@/lib/ipc"

export type ModelEntry = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
}

type ModelsResponse = {
  models: ModelEntry[]
  currentModel: string | null
}

let cachedModels: ModelEntry[] | null = null
let cachedCurrent: string | null = null

export function isActiveModel(
  current: string | null,
  model: ModelEntry,
): boolean {
  if (!current) return false
  const bare = current.includes("/") ? current.split("/")[1] : current
  return model.id === current || model.id === bare
}

export function useModels() {
  const [models, setModels] = useState<ModelEntry[]>(cachedModels ?? [])
  const [currentModel, setCurrentModel] = useState<string | null>(
    cachedCurrent,
  )
  const [loading, setLoading] = useState(!cachedModels)
  const fetched = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await invoke<ModelsResponse>("middleware_models_list", {
        input: {},
      })
      cachedModels = res.models ?? []
      cachedCurrent = res.currentModel ?? null
      setModels(cachedModels)
      setCurrentModel(cachedCurrent)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    load()
  }, [load])

  return { models, currentModel, loading, reload: load }
}
