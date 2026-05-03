"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { useUsageData } from "./usage/useUsageData"
import { UsageStatsCards } from "./usage/UsageStatsCards"
import { UsageChart } from "./usage/UsageChart"
import { UsageBreakdown } from "./usage/UsageBreakdown"
import type { UsagePeriod } from "./usage/types"

const PERIODS: { value: UsagePeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
]

export function UsageTab() {
  const [period, setPeriod] = useState<UsagePeriod>("7d")
  const {
    summary,
    providers,
    daily,
    loading,
    rangeLoading,
    error,
    lastUpdated,
    refresh,
  } = useUsageData(period)

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icons.Automations
            size={16}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            Token Usage
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-border/45 bg-card p-2 text-muted-foreground transition-all hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            title="Refresh"
          >
            <Icons.Refresh
              size={14}
              strokeWidth={1.5}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <div className="flex gap-0 rounded-lg border border-border/45 bg-card p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-medium transition-all",
                  period === p.value
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3">
          <p className="text-[12px] text-destructive">{error}</p>
        </div>
      )}

      <UsageStatsCards summary={summary} loading={rangeLoading} />

      <UsageChart daily={daily} lastUpdated={lastUpdated} loading={rangeLoading} />

      <UsageBreakdown providers={providers} loading={rangeLoading} />
    </div>
  )
}
