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

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-muted/60 animate-pulse ${className}`} />
}

function StatBlock({
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
    <div className="rounded-2xl border border-border/45 bg-card px-5 py-4 shadow-[0_1px_0_rgba(255,255,255,0.03)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
        {label}
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <SkeletonLine className="h-7 w-24" />
          <SkeletonLine className="h-3 w-28" />
        </div>
      ) : (
        <>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </div>
          {helper && <div className="mt-1 text-[11px] text-muted-foreground/65">{helper}</div>}
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
  const conversationTokens = summary.totalInputTokens + summary.totalOutputTokens
  const cacheTokens = summary.cacheReadTokens + summary.cacheWriteTokens
  const trackedTokens = conversationTokens + cacheTokens
  const inputShare = conversationTokens > 0 ? (summary.totalInputTokens / conversationTokens) * 100 : 0
  const outputShare = conversationTokens > 0 ? (summary.totalOutputTokens / conversationTokens) * 100 : 0
  const cacheShare = trackedTokens > 0 ? (cacheTokens / trackedTokens) * 100 : 0

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_.95fr]">
      <div className="rounded-3xl border border-border/50 bg-card p-5 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">
              Token Ledger
            </div>
            {loading ? (
              <div className="mt-3 space-y-2">
                <SkeletonLine className="h-9 w-40" />
                <SkeletonLine className="h-3 w-56" />
              </div>
            ) : (
              <>
                <div className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-foreground tabular-nums">
                  {formatTokens(trackedTokens)}
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground/65">
                  All tracked tokens, including cache reads and writes
                </div>
              </>
            )}
          </div>
          <div className="rounded-2xl border border-border/45 bg-background/45 px-4 py-3 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
              Cost
            </div>
            {loading ? (
              <SkeletonLine className="mt-2 h-6 w-20" />
            ) : (
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                ${summary.totalCost.toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/40 bg-background/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-muted-foreground">Conversation</span>
              <span className="text-[11px] text-muted-foreground/60">input + output</span>
            </div>
            {loading ? (
              <div className="mt-3 space-y-2">
                <SkeletonLine className="h-6 w-28" />
                <SkeletonLine className="h-2 w-full rounded-full" />
              </div>
            ) : (
              <>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                  {formatTokens(conversationTokens)}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/55">
                  <div
                    className="h-full rounded-full bg-foreground/75"
                    style={{ width: `${Math.min(inputShare + outputShare, 100)}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground/65">
                  <span>{formatPercent(inputShare)} input</span>
                  <span>{formatPercent(outputShare)} output</span>
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border/40 bg-background/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-muted-foreground">Cache</span>
              <span className="text-[11px] text-muted-foreground/60">read + write</span>
            </div>
            {loading ? (
              <div className="mt-3 space-y-2">
                <SkeletonLine className="h-6 w-28" />
                <div className="grid grid-cols-2 gap-2">
                  <SkeletonLine className="h-9" />
                  <SkeletonLine className="h-9" />
                </div>
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-foreground">{formatTokens(cacheTokens)}</span>
                  <span className="text-[11px] text-muted-foreground/60">{formatPercent(cacheShare)} of total</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/35 bg-card/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/55">Read</div>
                    <div className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatTokens(summary.cacheReadTokens)}</div>
                  </div>
                  <div className="rounded-xl border border-border/35 bg-card/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/55">Write</div>
                    <div className="mt-1 text-sm font-medium tabular-nums text-foreground">{formatTokens(summary.cacheWriteTokens)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <StatBlock
          label="Input"
          value={formatTokens(summary.totalInputTokens)}
          helper={`${formatPercent(inputShare)} of conversation`}
          loading={loading}
        />
        <StatBlock
          label="Output"
          value={formatTokens(summary.totalOutputTokens)}
          helper={`${formatPercent(outputShare)} of conversation`}
          loading={loading}
        />
        <StatBlock
          label="Cache Saved Context"
          value={formatTokens(cacheTokens)}
          helper="Separated from conversation tokens"
          loading={loading}
        />
      </div>
    </div>
  )
}
