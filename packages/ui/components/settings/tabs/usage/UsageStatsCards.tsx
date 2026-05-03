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
  return <div className={`animate-pulse rounded bg-muted/55 ${className}`} />
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
    <div className="min-w-0 rounded-sm border border-border/35 bg-background/35 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/58">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-5 w-20 max-w-full" />
          <Skeleton className="h-3 w-24 max-w-full" />
        </div>
      ) : (
        <>
          <div className="mt-1.5 truncate text-[20px] font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </div>
          {helper && (
            <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground/58">
              {helper}
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

export function UsageStatsCards({ summary, loading = false }: UsageStatsCardsProps) {
  const conversationTokens = summary.totalInputTokens + summary.totalOutputTokens
  const cacheTokens = summary.cacheReadTokens + summary.cacheWriteTokens
  const trackedTokens = conversationTokens + cacheTokens
  const inputShare = conversationTokens > 0 ? (summary.totalInputTokens / conversationTokens) * 100 : 0
  const outputShare = conversationTokens > 0 ? (summary.totalOutputTokens / conversationTokens) * 100 : 0
  const conversationShare = trackedTokens > 0 ? (conversationTokens / trackedTokens) * 100 : 0
  const cacheShare = trackedTokens > 0 ? (cacheTokens / trackedTokens) * 100 : 0

  return (
    <section className="min-w-0 rounded-sm border border-border/45 bg-card/75 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-5">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 gap-3 min-[520px]:grid-cols-[1fr_auto] min-[520px]:items-start">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/58">
              Usage overview
            </div>
            {loading ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-10 w-44 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            ) : (
              <>
                <div className="mt-1.5 truncate text-[34px] font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-4xl">
                  {formatTokens(trackedTokens)}
                </div>
                <p className="mt-2 max-w-md text-[12px] leading-5 text-muted-foreground/62">
                  Total tracked tokens. Conversation and cache are shown separately so the math is clear.
                </p>
              </>
            )}
          </div>

          <div className="w-full min-w-0 rounded-sm border border-border/35 bg-background/35 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md min-[520px]:w-[132px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/58">
              Spend
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24 max-w-full" />
            ) : (
              <div className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                ${summary.totalCost.toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <div>
          {loading ? (
            <Skeleton className="h-3 w-full" />
          ) : (
            <div className="h-3 overflow-hidden rounded bg-muted/45">
              <div
                className="float-left h-full bg-foreground/78"
                style={{ width: `${Math.min(conversationShare, 100)}%` }}
              />
              <div
                className="h-full bg-muted-foreground/42"
                style={{ width: `${Math.min(cacheShare, 100)}%` }}
              />
            </div>
          )}
          <div className="mt-2 flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground/58">
            <span>Conversation {loading ? "—" : formatPercent(conversationShare)}</span>
            <span>Cache {loading ? "—" : formatPercent(cacheShare)}</span>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-3">
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
