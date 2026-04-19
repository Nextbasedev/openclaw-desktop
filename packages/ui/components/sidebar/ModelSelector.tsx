"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuChevronDown, LuCheck, LuZap, LuSearch, LuX } from "react-icons/lu"

type ModelEntry = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
}

function isActiveModel(current: string | null, model: ModelEntry): boolean {
  if (!current) return false
  const bare = current.includes("/") ? current.split("/")[1] : current
  return model.id === current || model.id === bare
}

export function ModelSelector() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await invoke<{
        models: ModelEntry[]
        currentModel: string | null
      }>("middleware_models_list", { input: {} })
      setModels(res.models ?? [])
      setCurrent(res.currentModel ?? null)
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (open) {
      setQuery("")
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open])

  async function handleSelect(modelId: string) {
    setSaving(true)
    try {
      await invoke("middleware_models_set_default", {
        input: { modelId },
      })
      setCurrent(modelId)
    } catch {}
    finally {
      setSaving(false)
      setOpen(false)
    }
  }

  const currentModel = models.find((m) => isActiveModel(current, m))
  const label = currentModel?.name ?? current ?? "Select model"

  const filtered = models.filter((m) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  })

  const grouped = filtered.reduce<Record<string, ModelEntry[]>>((acc, m) => {
    const key = m.provider
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={saving}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2",
          "text-left transition-colors duration-150",
          "hover:bg-secondary/40",
          saving && "opacity-50",
        )}
      >
        <LuZap size={13} className="shrink-0 text-amber-400" />
        <span className="flex-1 truncate text-[12px] font-medium text-foreground/80">
          {label}
        </span>
        <LuChevronDown size={12} className="shrink-0 text-muted-foreground/50" />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className={cn(
            "relative w-full max-w-md mx-4",
            "rounded-2xl border border-border/50 bg-card/95 backdrop-blur-xl",
            "shadow-2xl shadow-black/30",
            "animate-in fade-in-0 zoom-in-95 duration-150",
          )}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-foreground">Select Model</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
              >
                <LuX size={15} />
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="relative">
                <LuSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models..."
                  className={cn(
                    "h-9 w-full rounded-lg border border-border/50 bg-secondary/30 pl-9 pr-3",
                    "text-[13px] text-foreground outline-none",
                    "placeholder:text-muted-foreground/50 focus:border-foreground/20",
                  )}
                />
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto px-2 pb-4">
              {Object.entries(grouped).map(([provider, providerModels]) => (
                <div key={provider} className="mb-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    {provider}
                  </p>
                  {providerModels.map((model) => {
                    const active = isActiveModel(current, model)
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleSelect(`${model.provider}/${model.id}`)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                          "transition-colors hover:bg-secondary/40",
                          active && "bg-secondary/30",
                        )}
                      >
                        <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                          <span className="truncate text-[13px] font-medium text-foreground/90">
                            {model.name}
                          </span>
                          {model.reasoning && (
                            <span className="text-[10px] text-amber-400/70">reasoning</span>
                          )}
                        </div>
                        {active && <LuCheck size={14} className="shrink-0 text-emerald-400" />}
                      </button>
                    )
                  })}
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                  No models match &ldquo;{query}&rdquo;
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
