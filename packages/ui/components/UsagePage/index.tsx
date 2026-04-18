"use client"

import { cn } from "@/lib/utils"
import { useUsageSummary } from "@/hooks/useUsageSummary"
import type { CostUsageTotals, DailyUsageEntry } from "@/lib/api/usage"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

type UsagePageProps = {
  onBack?: () => void
}

export function UsagePage({ onBack }: UsagePageProps) {
  const { data, loading, error } = useUsageSummary()

  if (loading) return <UsageSkeleton />

  if (error) {
    return (
      <div className="w-full">
        <h1 className="mb-6 text-xl font-semibold text-foreground">Usage</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-destructive">Failed to load usage data</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { totals, daily, days } = data

  return (
    <div className="w-full">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-foreground">Usage</h1>
        <span className="text-xs text-muted-foreground">
          {days} day{days !== 1 ? "s" : ""} tracked
        </span>
      </div>

      {/* Cost overview cards */}
      <section className="mb-8">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Cost" value={formatCost(totals.totalCost)} highlight />
          <StatCard label="Input Cost" value={formatCost(totals.inputCost)} />
          <StatCard label="Output Cost" value={formatCost(totals.outputCost)} />
        </div>
      </section>

      {/* Token breakdown */}
      <section className="mb-8">
        <h2 className="mb-3 text-[13px] font-semibold text-foreground">Token Breakdown</h2>
        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          <TokenRow label="Input Tokens" tokens={totals.input} cost={totals.inputCost} totals={totals} />
          <TokenRow label="Output Tokens" tokens={totals.output} cost={totals.outputCost} totals={totals} border />
          <TokenRow label="Cache Read" tokens={totals.cacheRead} cost={totals.cacheReadCost} totals={totals} border />
          <TokenRow label="Cache Write" tokens={totals.cacheWrite} cost={totals.cacheWriteCost} totals={totals} border />
          <div className="flex items-center justify-between border-t border-border/50 bg-secondary/20 px-5 py-3">
            <span className="text-[13px] font-semibold text-foreground">Total</span>
            <div className="flex items-center gap-4">
              <span className="text-[13px] font-semibold tabular-nums text-foreground">
                {formatTokens(totals.totalTokens)}
              </span>
              <span className="min-w-[70px] text-right text-[13px] font-semibold tabular-nums text-foreground">
                {formatCost(totals.totalCost)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Daily usage */}
      {daily.length > 0 && (
        <section>
          <h2 className="mb-3 text-[13px] font-semibold text-foreground">Daily Activity</h2>
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
            {/* Bar chart */}
            <div className="px-5 pt-5 pb-3">
              <DailyChart daily={daily} />
            </div>

            {/* Day rows */}
            <div className="border-t border-border/30">
              {[...daily].reverse().map((day, idx) => (
                <div
                  key={day.date}
                  className={cn(
                    "flex items-center justify-between px-5 py-2.5",
                    idx > 0 && "border-t border-border/20",
                  )}
                >
                  <span className="text-[13px] text-muted-foreground">{formatDate(day.date)}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-[13px] tabular-nums text-muted-foreground">
                      {formatTokens(day.totalTokens)}
                    </span>
                    <span className="min-w-[70px] text-right text-[13px] tabular-nums text-foreground">
                      {formatCost(day.totalCost)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border px-4 py-3.5",
        highlight
          ? "border-foreground/10 bg-foreground/[0.03]"
          : "border-border/50 bg-card",
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", highlight ? "text-foreground" : "text-foreground/80")}>
        {value}
      </span>
    </div>
  )
}

function TokenRow({
  label,
  tokens,
  cost,
  totals,
  border,
}: {
  label: string
  tokens: number
  cost: number
  totals: CostUsageTotals
  border?: boolean
}) {
  const pct = totals.totalTokens > 0 ? (tokens / totals.totalTokens) * 100 : 0

  return (
    <div className={cn("flex items-center gap-4 px-5 py-3", border && "border-t border-border/30")}>
      <span className="w-[110px] shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-foreground/40 transition-all duration-500"
            style={{ width: `${Math.max(pct, 0.5)}%` }}
          />
        </div>
      </div>
      <span className="min-w-[60px] text-right text-[13px] tabular-nums text-muted-foreground">
        {formatTokens(tokens)}
      </span>
      <span className="min-w-[70px] text-right text-[13px] tabular-nums text-foreground">
        {formatCost(cost)}
      </span>
    </div>
  )
}

function DailyChart({ daily }: { daily: DailyUsageEntry[] }) {
  const maxTokens = Math.max(...daily.map((d) => d.totalTokens), 1)

  return (
    <div className="flex h-20 items-end gap-[3px]">
      {daily.map((day) => {
        const heightPct = (day.totalTokens / maxTokens) * 100
        return (
          <div
            key={day.date}
            className="group relative flex-1"
            title={`${formatDate(day.date)}: ${formatTokens(day.totalTokens)} tokens, ${formatCost(day.totalCost)}`}
          >
            <div
              className="w-full rounded-t-sm bg-foreground/15 transition-colors group-hover:bg-foreground/30"
              style={{ height: `${Math.max(heightPct, 2)}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

function UsageSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="mb-8 h-6 w-24 rounded bg-secondary/60" />
      <div className="mb-8 grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] rounded-xl border border-border/50 bg-card" />
        ))}
      </div>
      <div className="mb-3 h-4 w-32 rounded bg-secondary/60" />
      <div className="h-[200px] rounded-xl border border-border/50 bg-card" />
    </div>
  )
}
