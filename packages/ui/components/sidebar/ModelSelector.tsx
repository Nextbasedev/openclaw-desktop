"use client"

import { useState, useRef, useEffect } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuCheck, LuSearch } from "react-icons/lu"
import { GlassDialog } from "@/components/ui/GlassDialog"
import { useModels, isActiveModel } from "@/hooks/useModels"
import { ModelLogo } from "@/components/model/ModelLogo"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelSelector({ open, onOpenChange }: Props) {
  const { models, currentModel: current, loading, error, reload } = useModels()
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      reload()
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [reload, open])

  async function handleSelect(modelId: string) {
    setSaving(true)
    try {
      await invoke("middleware_models_set_default", {
        input: { modelId },
      })
      await reload()
    } catch {
    } finally {
      setSaving(false)
      onOpenChange(false)
    }
  }

  const currentModel = models.find((m) => isActiveModel(current, m))
  const label = currentModel?.name ?? current ?? "Select model"
  const currentDisplayModel =
    currentModel ??
    (current
      ? {
          id: current.includes("/") ? current.split(/\/(.+)/)[1] : current,
          name: current.includes("/") ? current.split(/\/(.+)/)[1] : current,
          provider: current.includes("/")
            ? current.split(/\/(.+)/)[0]
            : "custom",
        }
      : null)

  const unique = models.filter(
    (m, i, arr) =>
      arr.findIndex((x) => x.name.toLowerCase() === m.name.toLowerCase()) === i
  )

  const filtered = unique.filter((m) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    )
  })

  return (
    <GlassDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Switch model"
      className="w-[min(460px,calc(100vw-32px))]"
    >
      <div className="-mx-1 -mt-1 border-b border-black/[0.06] px-1 pb-4 dark:border-white/[0.07]">
        <div className="flex items-center gap-3 rounded-2xl bg-black/[0.025] px-3 py-2.5 dark:bg-white/[0.035]">
          <ModelLogo model={currentDisplayModel} modelId={current} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">
              {label}
            </p>
            <p className="truncate text-[11px] text-muted-foreground/60">
              Current model
              {currentDisplayModel?.provider
                ? ` · ${currentDisplayModel.provider}`
                : ""}
            </p>
          </div>
          <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-medium text-emerald-500 dark:text-emerald-300">
            Active
          </span>
        </div>
      </div>

      <div className="py-4">
        <div className="relative rounded-xl border border-black/[0.06] bg-black/[0.03] transition-colors focus-within:border-black/[0.12] focus-within:bg-black/[0.045] dark:border-white/[0.08] dark:bg-white/[0.035] dark:focus-within:border-white/[0.14] dark:focus-within:bg-white/[0.05]">
          <LuSearch
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground/55"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by model or provider"
            className={cn(
              "h-10 w-full rounded-xl border-0 bg-transparent pr-3 pl-9",
              "text-[13px] text-foreground outline-none",
              "placeholder:text-muted-foreground/45"
            )}
          />
        </div>
      </div>

      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
        {loading && models.length === 0 && (
          <p className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
            Loading models...
          </p>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-2 px-2.5 py-4">
            <p className="text-center text-[12px] text-red-400">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="cursor-pointer rounded-md px-3 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
            >
              Retry
            </button>
          </div>
        )}
        {!loading &&
          !error &&
          filtered.map((model) => {
            const active = isActiveModel(current, model)
            return (
              <button
                key={`${model.provider}/${model.id}`}
                type="button"
                disabled={saving}
                onClick={() => handleSelect(`${model.provider}/${model.id}`)}
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left",
                  "transition-[background-color,border-color,box-shadow] disabled:cursor-not-allowed",
                  "focus-visible:ring-1 focus-visible:ring-foreground/20 focus-visible:outline-none",
                  saving && "opacity-50",
                  active
                    ? "border-emerald-400/20 bg-emerald-400/[0.08] text-foreground shadow-[inset_3px_0_0_rgba(52,211,153,0.65)]"
                    : "border-transparent text-foreground/82 hover:border-black/[0.06] hover:bg-black/[0.035] hover:text-foreground dark:hover:border-white/[0.08] dark:hover:bg-white/[0.045]"
                )}
              >
                <ModelLogo model={model} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {model.name}
                    </span>
                    {model.reasoning && (
                      <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-muted-foreground/70 uppercase">
                        Reasoning
                      </span>
                    )}
                  </div>
                  <span className="truncate text-[11px] text-muted-foreground/58">
                    {model.provider}
                  </span>
                </div>
                {active && (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-500 dark:text-emerald-300">
                    <LuCheck size={13} />
                  </span>
                )}
              </button>
            )
          })}
        {!loading && !error && filtered.length === 0 && (
          <p className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
            No models match &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
    </GlassDialog>
  )
}
