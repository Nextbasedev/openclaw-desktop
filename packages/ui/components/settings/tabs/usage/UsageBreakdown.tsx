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
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/45 bg-card/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      <div className="border-b border-border/35 px-4 py-3.5 sm:px-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
          Provider Status
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 p-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="grid min-w-0 gap-3 rounded-lg border border-border/35 bg-background/35 px-3.5 py-3 min-[520px]:grid-cols-[1fr_auto_auto] min-[520px]:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-28 max-w-full animate-pulse rounded bg-muted/55" />
                <div className="h-3 w-16 max-w-full animate-pulse rounded bg-muted/55" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="h-3 w-24 max-w-full animate-pulse rounded bg-muted/55" />
                <div className="h-1 w-24 max-w-full animate-pulse rounded bg-muted/55" />
              </div>
              <div className="h-6 w-14 animate-pulse rounded-md bg-muted/55" />
            </div>
          ))
        ) : (
        providers.map((p) => (
          <div
            key={p.provider}
            className="grid min-w-0 gap-3 rounded-lg border border-border/35 bg-background/35 px-3.5 py-3 min-[520px]:grid-cols-[1fr_auto_auto] min-[520px]:items-center"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[13px] font-semibold text-foreground">
                {p.displayName}
              </span>
              {p.plan && (
                <span className="truncate text-[11px] text-muted-foreground/60">
                  {p.plan}
                </span>
              )}
            </div>

            {p.windows.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                {p.windows.map((w) => (
                  <div key={w.label} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-6">
                      <span className="text-[11px] text-muted-foreground/58">
                        {w.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-foreground/72">
                        {w.usedPercent}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-muted/50 min-[520px]:w-24">
                      <div
                        className="h-full rounded bg-foreground/72 transition-all"
                        style={{
                          width: `${Math.min(w.usedPercent, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex-shrink-0">
              {p.error ? (
                <span className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
                  Error
                </span>
              ) : (
                <span className="rounded-md border border-border/35 bg-muted/35 px-2.5 py-1 text-[11px] font-medium text-foreground/75">
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
