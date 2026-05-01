"use client"

import type { UsageSummary } from "./types"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function StatCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 backdrop-blur-xl">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
        {label}
      </span>
      <span className="text-2xl font-bold tracking-tight text-foreground">
        {value}
      </span>
    </div>
  )
}

type UsageStatsCardsProps = {
  summary: UsageSummary
}

export function UsageStatsCards({
  summary,
}: UsageStatsCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard
        label="Total Tokens"
        value={formatTokens(summary.totalTokens)}
      />
      <StatCard
        label="Input / Output"
        value={`${formatTokens(summary.totalInputTokens)} / ${formatTokens(summary.totalOutputTokens)}`}
      />
      <StatCard
        label="Cost (USD)"
        value={`$${summary.totalCost.toFixed(2)}`}
      />
    </div>
  )
}
