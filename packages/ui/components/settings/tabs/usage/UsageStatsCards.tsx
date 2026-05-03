"use client"

import type { UsageSummary } from "./types"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%"
  if (value < 1 && value > 0) return "<1%"
  return `${Math.round(value)}%`
}

function MetricCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string
  value: string
  detail?: string
  loading?: boolean
}) {
  return (
    <div className="usage-neu-card rounded-2xl px-5 py-4">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
        {label}
      </span>
      {loading ? (
        <div className="mt-3 space-y-2">
          <div className="h-7 w-24 rounded-md bg-muted/60 animate-pulse" />
          <div className="h-3 w-32 rounded-md bg-muted/45 animate-pulse" />
        </div>
      ) : (
        <>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </div>
          {detail && (
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground/65">
              {detail}
            </div>
          )}
        </>
      )}
    </div>
  )
}

type UsageStatsCardsProps = {
  summary: UsageSummary
  loading?: boolean
}

export function UsageStatsCards({
  summary,
  loading = false,
}: UsageStatsCardsProps) {
  const visibleTotalTokens = summary.totalInputTokens + summary.totalOutputTokens
  const cacheTokens = summary.cacheReadTokens + summary.cacheWriteTokens
  const allTrackedTokens = visibleTotalTokens + cacheTokens
  const inputShare = visibleTotalTokens > 0 ? (summary.totalInputTokens / visibleTotalTokens) * 100 : 0
  const outputShare = visibleTotalTokens > 0 ? (summary.totalOutputTokens / visibleTotalTokens) * 100 : 0
  const cacheShare = allTrackedTokens > 0 ? (cacheTokens / allTrackedTokens) * 100 : 0

  return (
    <div className="grid gap-3 xl:grid-cols-[1.05fr_1.25fr_1.15fr_.85fr] md:grid-cols-2">
      <MetricCard
        label="Conversation Tokens"
        value={formatTokens(visibleTotalTokens)}
        detail="Input + output only"
        loading={loading}
      />

      <div className="usage-neu-card rounded-2xl px-5 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
          Input / Output
        </span>
        {loading ? (
          <div className="mt-3 space-y-3">
            <div className="h-7 w-36 rounded-md bg-muted/60 animate-pulse" />
            <div className="h-2 w-full rounded-full bg-muted/45 animate-pulse" />
          </div>
        ) : (
          <>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatTokens(summary.totalInputTokens)} <span className="text-muted-foreground/35">/</span> {formatTokens(summary.totalOutputTokens)}
            </div>
            <div className="usage-neu-inset mt-3 h-2 overflow-hidden rounded-full">
              <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(inputShare + outputShare, 100)}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground/65">
              <span>{formatPercent(inputShare)} input</span>
              <span>{formatPercent(outputShare)} output</span>
            </div>
          </>
        )}
      </div>

      <div className="usage-neu-card rounded-2xl px-5 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
          Cache Tokens
        </span>
        {loading ? (
          <div className="mt-3 space-y-3">
            <div className="h-7 w-28 rounded-md bg-muted/60 animate-pulse" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-10 rounded-lg bg-muted/45 animate-pulse" />
              <div className="h-10 rounded-lg bg-muted/45 animate-pulse" />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatTokens(cacheTokens)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/65">
              {formatPercent(cacheShare)} of tracked tokens came from cache
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="usage-neu-inset rounded-xl px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50">Read</div>
                <div className="mt-1 text-sm font-medium tabular-nums text-foreground/90">{formatTokens(summary.cacheReadTokens)}</div>
              </div>
              <div className="usage-neu-inset rounded-xl px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50">Write</div>
                <div className="mt-1 text-sm font-medium tabular-nums text-foreground/90">{formatTokens(summary.cacheWriteTokens)}</div>
              </div>
            </div>
          </>
        )}
      </div>

      <MetricCard
        label="Cost"
        value={`$${summary.totalCost.toFixed(2)}`}
        detail={`${formatTokens(allTrackedTokens)} tracked total`}
        loading={loading}
      />
    </div>
  )
}
