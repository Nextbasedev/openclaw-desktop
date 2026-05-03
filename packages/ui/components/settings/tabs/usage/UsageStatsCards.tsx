"use client"

import type { UsageSummary } from "./types"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%"
  if (value < 1) return "<1%"
  return `${Math.round(value)}%`
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/55 ${className}`} />
}

function MiniMetric({
  label,
  value,
  helper,
  loading,
}: {
  label: string
  value: string
  helper?: string
  loading?: boolean
}) {
  return (
    <div className="rounded-xl border border-border/35 bg-background/35 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/60">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : (
        <>
          <div className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </div>
          {helper && <div className="mt-0.5 text-[11px] text-muted-foreground/60">{helper}</div>}
        </>
      )}
    </div>
  )
}

type UsageStatsCardsProps = {
  summary: UsageSummary
  loading?: boolean
}

export function UsageStatsCards({ summary, loading = false }: UsageStatsCardsProps) {
  const conversationTokens = summary.totalInputTokens + summary.totalOutputTokens
  const cacheTokens = summary.cacheReadTokens + summary.cacheWriteTokens
  const trackedTokens = conversationTokens + cacheTokens
  const inputShare = conversationTokens > 0 ? (summary.totalInputTokens / conversationTokens) * 100 : 0
  const outputShare = conversationTokens > 0 ? (summary.totalOutputTokens / conversationTokens) * 100 : 0
  const conversationShare = trackedTokens > 0 ? (conversationTokens / trackedTokens) * 100 : 0
  const cacheShare = trackedTokens > 0 ? (cacheTokens / trackedTokens) * 100 : 0

  return (
    <section className="rounded-3xl border border-border/50 bg-card p-5 shadow-[0_18px_48px_rgba(0,0,0,0.14)]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
              Usage overview
            </div>
            {loading ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-10 w-44" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            ) : (
              <>
                <div className="mt-1.5 text-4xl font-semibold tracking-[-0.045em] text-foreground tabular-nums">
                  {formatTokens(trackedTokens)}
                </div>
                <p className="mt-1 max-w-md text-[12px] leading-5 text-muted-foreground/65">
                  Total tracked tokens. Conversation and cache are shown separately so the math is clear.
                </p>
              </>
            )}
          </div>

          <div className="min-w-[140px] rounded-2xl border border-border/40 bg-background/40 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/60">
              Spend
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                ${summary.totalCost.toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <div>
          {loading ? (
            <Skeleton className="h-3 w-full rounded-full" />
          ) : (
            <div className="h-3 overflow-hidden rounded-full bg-muted/50">
              <div
                className="float-left h-full bg-foreground/75"
                style={{ width: `${Math.min(conversationShare, 100)}%` }}
              />
              <div
                className="h-full bg-muted-foreground/45"
                style={{ width: `${Math.min(cacheShare, 100)}%` }}
              />
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground/65">
            <span>Conversation {loading ? "—" : formatPercent(conversationShare)}</span>
            <span>Cache {loading ? "—" : formatPercent(cacheShare)}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniMetric
            label="Conversation"
            value={formatTokens(conversationTokens)}
            helper="Input + output"
            loading={loading}
          />
          <MiniMetric
            label="Input"
            value={formatTokens(summary.totalInputTokens)}
            helper={`${formatPercent(inputShare)} of conversation`}
            loading={loading}
          />
          <MiniMetric
            label="Output"
            value={formatTokens(summary.totalOutputTokens)}
            helper={`${formatPercent(outputShare)} of conversation`}
            loading={loading}
          />
          <MiniMetric
            label="Cache"
            value={formatTokens(cacheTokens)}
            helper={`${formatTokens(summary.cacheReadTokens)} read · ${formatTokens(summary.cacheWriteTokens)} write`}
            loading={loading}
          />
        </div>
      </div>
    </section>
  )
}
