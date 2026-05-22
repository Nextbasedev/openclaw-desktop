"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import { dedupeRequest, invalidateDedupe } from "@/lib/requestDedupe"

export type ModelEntry = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
  health?: {
    status: "available" | "unavailable" | "degraded"
    reason?: string
    code?: string
  }
}

type RawModelEntry = ModelEntry | string | { id?: string; name?: string; provider?: string; model?: string; value?: string; reasoning?: boolean; health?: ModelEntry["health"] }

type ModelsResponse = {
  models?: RawModelEntry[]
  currentModel?: string | null
  defaultModel?: string | null
}

function normalizeModelEntry(entry: RawModelEntry): ModelEntry | null {
  if (typeof entry === "string") {
    const ref = entry
    if (!ref.trim()) return null
    const [provider, id] = ref.includes("/") ? ref.split(/\/(.+)/) : ["custom", ref]
    return { id, provider, name: id, reasoning: false }
  }

  const raw = entry as { id?: string; name?: string; provider?: string; model?: string; value?: string; reasoning?: boolean; health?: ModelEntry["health"] }
  const ref = String(raw.id || raw.model || raw.value || "")
  if (!ref.trim()) return null
  const [providerFromRef, idFromRef] = ref.includes("/") ? ref.split(/\/(.+)/) : ["custom", ref]
  const provider = String(raw.provider || providerFromRef || "custom")
  const id = String(raw.id || idFromRef || ref)
  return { id, provider, name: String(raw.name || id), reasoning: Boolean(raw.reasoning), health: raw.health }
}

function normalizeModelsResponse(response: ModelsResponse): { models: ModelEntry[]; currentModel: string | null } {
  const models = (response.models ?? []).map(normalizeModelEntry).filter((model): model is ModelEntry => Boolean(model))
  const currentModel = response.currentModel ?? response.defaultModel ?? null
  if (currentModel && !models.some((model) => model.id === currentModel || `${model.provider}/${model.id}` === currentModel)) {
    const current = normalizeModelEntry(currentModel)
    if (current) models.unshift(current)
  }
  return { models, currentModel }
}

let cachedModels: ModelEntry[] | null = null
let cachedCurrent: string | null = null
let cachedConnectionKey: string | null = null

const MODELS_REQUEST_TTL_MS = 3_000

function currentMiddlewareConnectionKey(): string | null {
  if (typeof window === "undefined") return null
  const url = localStorage.getItem("openclaw.middleware.url")?.trim() ?? ""
  const token = localStorage.getItem("openclaw.middleware.token")?.trim() ?? ""
  return url ? `${url}|${token ? "token" : "no-token"}` : null
}

function modelsRequestKey(connectionKey: string | null) {
  return `models:${connectionKey ?? "default"}`
}

function clearModelsCache() {
  invalidateDedupe("models:")
  cachedModels = null
  cachedCurrent = null
  cachedConnectionKey = null
}

export function isActiveModel(
  current: string | null,
  model: ModelEntry,
): boolean {
  if (!current) return false
  const bare = current.includes("/") ? current.split(/\/(.+)/)[1] : current
  return model.id === current || `${model.provider}/${model.id}` === current || model.id === bare
}

export function useModels() {
  const [models, setModels] = useState<ModelEntry[]>(cachedModels ?? [])
  const [currentModel, setCurrentModel] = useState<string | null>(
    cachedCurrent,
  )
  const [loading, setLoading] = useState(!cachedModels)
  const [error, setError] = useState<string | null>(null)
  const fetched = useRef(false)

  const load = useCallback(async (force = false) => {
    const connectionKey = currentMiddlewareConnectionKey()
    if (cachedConnectionKey !== connectionKey) {
      clearModelsCache()
      cachedConnectionKey = connectionKey
      fetched.current = false
      setModels([])
      setCurrentModel(null)
    }
    if (!force && fetched.current && cachedModels) return
    if (force) invalidateDedupe(modelsRequestKey(connectionKey))
    fetched.current = true
    setError(null)
    setLoading(true)
    try {
      const normalized = await dedupeRequest(
        modelsRequestKey(connectionKey),
        async () => normalizeModelsResponse(await invoke<ModelsResponse>("middleware_models_list", {
          input: {},
        })),
        { ttlMs: MODELS_REQUEST_TTL_MS },
      )
      cachedModels = normalized.models
      cachedCurrent = normalized.currentModel
      cachedConnectionKey = connectionKey
      setModels(cachedModels)
      setCurrentModel(cachedCurrent)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models")
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    function handleConnectionChange() {
      clearModelsCache()
      fetched.current = false
      setModels([])
      setCurrentModel(null)
      void load(true)
    }

    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, handleConnectionChange)
    window.addEventListener("openclaw:middleware-connected", handleConnectionChange)
    return () => {
      window.removeEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, handleConnectionChange)
      window.removeEventListener("openclaw:middleware-connected", handleConnectionChange)
    }
  }, [load])

  const ensureLoaded = useCallback(() => load(false), [load])
  const reload = useCallback(() => load(true), [load])

  return { models, currentModel, loading, error, reload, ensureLoaded }
}
