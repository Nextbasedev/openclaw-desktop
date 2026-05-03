"use client"

import type { ProviderStatus } from "./types"

type UsageBreakdownProps = {
  providers: ProviderStatus[]
  loading?: boolean
}

export function UsageBreakdown({
  providers,
  loading = false,
}: UsageBreakdownProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl">
      <div className="px-5 py-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          Provider Status
        </span>
      </div>

      <div className="flex flex-col gap-3 px-5 pb-5">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 backdrop-blur-xl"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-28 rounded bg-white/[0.06] animate-pulse" />
                <div className="h-3 w-16 rounded bg-white/[0.06] animate-pulse" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="h-3 w-24 rounded bg-white/[0.06] animate-pulse" />
                <div className="h-1 w-24 rounded-full bg-white/[0.06] animate-pulse" />
              </div>
              <div className="h-6 w-14 rounded-md bg-white/[0.06] animate-pulse" />
            </div>
          ))
        ) : (
        providers.map((p) => (
          <div
            key={p.provider}
            className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 backdrop-blur-xl"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[13px] font-semibold text-foreground">
                {p.displayName}
              </span>
              {p.plan && (
                <span className="text-[11px] text-muted-foreground/60">
                  {p.plan}
                </span>
              )}
            </div>

            {p.windows.length > 0 && (
              <div className="flex flex-col gap-2">
                {p.windows.map((w) => (
                  <div key={w.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-6">
                      <span className="text-[11px] text-muted-foreground/60">
                        {w.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-foreground/70">
                        {w.usedPercent}%
                      </span>
                    </div>
                    <div className="h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-emerald-400/80 transition-all"
                        style={{
                          width: `${Math.min(w.usedPercent, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="ml-2 flex-shrink-0">
              {p.error ? (
                <span className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400">
                  Error
                </span>
              ) : (
                <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                  Active
                </span>
              )}
            </div>
          </div>
        ))
        )}
      </div>
    </div>
  )
}
