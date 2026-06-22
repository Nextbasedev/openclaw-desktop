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
    <div className="flex min-w-0 flex-col gap-4 pb-8">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-card/70 text-muted-foreground shadow-sm backdrop-blur-md">
            <Icons.Automations size={14} strokeWidth={1.7} />
          </div> */}
          <div className="min-w-0">
            <span className="block text-[16px] font-semibold uppercase tracking-[0.14em] text-foreground">
              Token Usage
            </span>
            <span className="block truncate text-[12px] text-muted-foreground/50">
              Dashboard
            </span>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="shrink-0 cursor-pointer rounded-lg bg-black/[0.035] dark:bg-white/[0.035] p-2 text-muted-foreground backdrop-blur-md transition-all hover:bg-black/[0.055] hover:text-foreground dark:hover:bg-white/[0.06] disabled:opacity-50"
            title="Refresh"
          >
            <Icons.Refresh
              size={14}
              strokeWidth={1.5}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <div className="flex min-w-0 gap-0 rounded-lg bg-black/[0.035] dark:bg-white/[0.035] p-0.5 backdrop-blur-md">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all sm:px-3",
                  period === p.value
                    ? "bg-foreground/10 text-foreground shadow-sm"
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
        <div className="rounded-xl bg-destructive/10 px-4 py-3">
          <p className="text-[12px] text-destructive">{error}</p>
        </div>
      )}

      <UsageStatsCards summary={summary} loading={rangeLoading} />

      <UsageChart daily={daily} lastUpdated={lastUpdated} loading={rangeLoading} />

      <UsageBreakdown providers={providers} loading={rangeLoading} />
    </div>
  )
}
