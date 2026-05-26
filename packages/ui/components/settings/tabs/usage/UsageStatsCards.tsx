"use client"

import { useEffect, useState } from "react"
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
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

function NumberPopIn({ value }: { value: string }) {
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    setPlaying(false)
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPlaying(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <span className={`t-digit-group ${playing ? "is-animating" : ""}`} aria-label={value}>
      {value.split("").map((ch, i) => (
        <span
          key={`${ch}-${i}`}
          aria-hidden="true"
          className="t-digit"
          data-stagger={i > 0 ? Math.min(i, 2) : undefined}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}

function MiniMetric({
  label,
  value,
  helper,
  className = "",
}: {
  label: string
  value: string
  helper?: string
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col p-5 bg-card/40 dark:bg-[#121212] ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-3 truncate text-[22px] font-semibold tabular-nums tracking-tight text-foreground">
        <NumberPopIn value={value} />
      </div>
      {helper && (
        <div className="mt-1 text-[12px] text-muted-foreground">
          {helper}
        </div>
      )}
    </div>
  )
}

function MiniMetricSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-[98px] min-w-0 flex-col p-5 bg-card/40 dark:bg-[#121212] ${className}`}>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-4 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  )
}

type UsageStatsCardsProps = {
  summary: UsageSummary
  loading?: boolean
}

export function UsageStatsCards({ summary, loading = false }: UsageStatsCardsProps) {
  if (loading) {
    return (
      <section className="flex flex-col rounded-md border border-border/40 overflow-hidden bg-card/40 dark:bg-[#121212]">
        <div className="p-6">
          <div className="flex flex-col gap-4 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24 mb-1" />
              <Skeleton className="h-[52px] w-48 mt-1" />
              <Skeleton className="h-4 w-64 mt-1.5" />
            </div>
            <div className="flex h-[104px] min-w-[150px] flex-col rounded-md border border-border/40 bg-transparent p-5">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="mt-4 h-8 w-24" />
            </div>
          </div>

          <div className="flex flex-col gap-4 mt-8">
            <Skeleton className="h-2.5 w-full rounded-full" />
            <div className="flex gap-6 mt-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-border/40">
          <MiniMetricSkeleton className="border-b border-r border-border/40 lg:border-b-0" />
          <MiniMetricSkeleton className="border-b border-border/40 lg:border-b-0 lg:border-r" />
          <MiniMetricSkeleton className="border-r border-border/40" />
          <MiniMetricSkeleton />
        </div>
      </section>
    )
  }

  const conversationTokens = summary.totalInputTokens + summary.totalOutputTokens
  const cacheTokens = summary.cacheReadTokens + summary.cacheWriteTokens
  const trackedTokens = conversationTokens + cacheTokens
  const inputShare = conversationTokens > 0 ? (summary.totalInputTokens / conversationTokens) * 100 : 0
  const outputShare = conversationTokens > 0 ? (summary.totalOutputTokens / conversationTokens) * 100 : 0
  const conversationShare = trackedTokens > 0 ? (conversationTokens / trackedTokens) * 100 : 0
  const cacheShare = trackedTokens > 0 ? (cacheTokens / trackedTokens) * 100 : 0

  return (
    <section className="flex flex-col rounded-md border border-border/40 overflow-hidden bg-card/40 dark:bg-[#121212]">
      <div className="p-6">
        <div className="flex flex-col gap-4 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Usage overview
            </div>
            <div className="mt-1 tabular-nums text-[34px] font-semibold leading-tight tracking-tight text-foreground">
              <NumberPopIn value={formatTokens(trackedTokens)} />
            </div>
            <div className="text-[14px] text-muted-foreground">
              Total tracked tokens across all usage
            </div>
          </div>

          <div className="flex min-w-[150px] flex-col rounded-md border border-border/40 bg-transparent p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Spend
            </div>
            <div className="mt-2 tabular-nums text-[24px] font-semibold tracking-tight text-foreground">
              <NumberPopIn value={`$${summary.totalCost.toFixed(2)}`} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 mt-8">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="float-left h-full bg-[#10b981] transition-all"
              style={{ width: `${Math.min(conversationShare, 100)}%` }}
            />
            <div
              className="h-full bg-[#3b82f6] transition-all"
              style={{ width: `${Math.min(cacheShare, 100)}%` }}
            />
          </div>
          <div className="flex gap-6 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
              Conversation {formatPercent(conversationShare)}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6]" />
              Cache {formatPercent(cacheShare)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-border/40">
        <MiniMetric
          label="Conversation"
          value={formatTokens(conversationTokens)}
          helper="Input + output"
          className="border-b border-r border-border/40 lg:border-b-0"
        />
        <MiniMetric
          label="Input"
          value={formatTokens(summary.totalInputTokens)}
          helper={`${formatPercent(inputShare)} of conv.`}
          className="border-b border-border/40 lg:border-b-0 lg:border-r"
        />
        <MiniMetric
          label="Output"
          value={formatTokens(summary.totalOutputTokens)}
          helper={`${formatPercent(outputShare)} of conv.`}
          className="border-r border-border/40"
        />
        <MiniMetric
          label="Cache"
          value={formatTokens(cacheTokens)}
          helper={`${formatTokens(summary.cacheReadTokens)} r · ${formatTokens(summary.cacheWriteTokens)} w`}
        />
      </div>
    </section>
  )
}
