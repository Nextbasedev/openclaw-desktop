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
    <div className="usage-neu-shell overflow-hidden rounded-3xl">
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
              className="usage-neu-card flex items-center gap-4 rounded-2xl px-5 py-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-28 rounded bg-muted/55 animate-pulse" />
                <div className="h-3 w-16 rounded bg-muted/55 animate-pulse" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="h-3 w-24 rounded bg-muted/55 animate-pulse" />
                <div className="h-1 w-24 rounded-full bg-muted/55 animate-pulse" />
              </div>
              <div className="h-6 w-14 rounded-md bg-muted/55 animate-pulse" />
            </div>
          ))
        ) : (
        providers.map((p) => (
          <div
            key={p.provider}
            className="usage-neu-card flex items-center gap-4 rounded-2xl px-5 py-4"
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
                    <div className="usage-neu-inset h-1.5 w-24 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-foreground/70 transition-all"
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
                <span className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
                  Error
                </span>
              ) : (
                <span className="usage-neu-inset rounded-md px-2.5 py-1 text-[11px] font-medium text-foreground/75">
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
