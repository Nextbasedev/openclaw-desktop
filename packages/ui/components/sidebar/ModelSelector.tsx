"use client"

import { useState, useRef, useEffect } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuChevronDown, LuCheck, LuZap, LuSearch } from "react-icons/lu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { useModels, isActiveModel, type ModelEntry } from "@/hooks/useModels"

export function ModelSelector() {
  const { models, currentModel: current, reload } = useModels()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open])

  async function handleSelect(modelId: string) {
    setSaving(true)
    try {
      await invoke("middleware_models_set_default", {
        input: { modelId },
      })
      await reload()
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
    return (
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    )
  })

  const grouped = filtered.reduce<Record<string, ModelEntry[]>>((acc, m) => {
    const key = m.provider
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
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
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className={cn("w-64 gap-0 p-0", GLASS_POPOVER)}
      >
        <div className="p-2 pb-0">
          <div className="relative">
            <LuSearch
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              className={cn(
                "h-8 w-full rounded-lg border pl-8 pr-3",
                "border-[var(--glass-input-border)] bg-[var(--glass-input-bg)]",
                "text-[12px] text-foreground outline-none",
                "placeholder:text-muted-foreground/40 focus:border-foreground/15",
              )}
            />
          </div>
        </div>

        <div className="max-h-[260px] overflow-y-auto p-1">
          {Object.entries(grouped).map(([provider, providerModels]) => (
            <div key={provider}>
              <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                {provider}
              </p>
              {providerModels.map((model) => {
                const active = isActiveModel(current, model)
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() =>
                      handleSelect(`${model.provider}/${model.id}`)
                    }
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
                      "transition-colors",
                      active
                        ? "bg-foreground/8 text-foreground"
                        : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
                    )}
                  >
                    <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                      <span className="truncate text-[13px] font-medium">
                        {model.name}
                      </span>
                      {model.reasoning && (
                        <span className="text-[10px] text-amber-400/70">
                          reasoning
                        </span>
                      )}
                    </div>
                    {active && (
                      <LuCheck
                        size={14}
                        className="shrink-0 text-emerald-400"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
              No models match &ldquo;{query}&rdquo;
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
