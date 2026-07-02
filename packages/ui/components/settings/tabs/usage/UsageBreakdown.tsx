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
  const statusBadge = (p: ProviderStatus) => (
    p.error ? (
      <span className="rounded-[4px] bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-500 dark:text-red-400">
        Error
      </span>
    ) : (
      <span className="rounded-[4px] bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-500">
        Active
      </span>
    )
  )

  if (loading) {
    return (
      <div className="flex flex-col gap-0 overflow-hidden rounded-md bg-black/[0.025] dark:bg-white/[0.025]">
        <div className="bg-black/[0.015] dark:bg-white/[0.015] px-5 py-4">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-col gap-3 p-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-[10px] bg-black/[0.035] dark:bg-white/[0.035] px-5 py-4"
            >
              <div className="flex flex-col gap-2">
                <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
                <div className="h-2.5 w-16 animate-pulse rounded-md bg-muted" />
              </div>
              <div className="flex items-center gap-6">
                <div className="flex flex-col gap-2">
                  <div className="h-2.5 w-24 animate-pulse rounded-md bg-muted" />
                  <div className="h-1.5 w-32 animate-pulse rounded-md bg-muted" />
                </div>
                <div className="h-6 w-14 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-md bg-black/[0.025] dark:bg-white/[0.025]">
      <div className="bg-black/[0.015] dark:bg-white/[0.015] px-5 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Provider Status
        </span>
      </div>

      <div className="flex flex-col gap-3 p-5">
        {providers.map((p) => (
          <div
            key={p.provider}
            className="flex items-center justify-between gap-4 rounded-[10px] bg-black/[0.025] px-5 py-4 transition-colors hover:bg-black/[0.045] dark:bg-white/[0.025] dark:hover:bg-white/[0.045]"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[14px] font-semibold text-foreground">
                {p.displayName}
              </span>
              {p.plan && (
                <span className="text-[12px] text-muted-foreground">
                  {p.plan}
                </span>
              )}
              {p.windows.length > 0 && (
                <div className="mt-2 flex flex-col gap-3">
                  {p.windows.map((w) => (
                    <div key={w.label} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-6">
                        <span className="text-[12px] text-muted-foreground">
                          {w.label}
                        </span>
                        <span className="tabular-nums text-[12px] font-semibold text-foreground/80">
                          {w.usedPercent}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border sm:w-32">
                        <div
                          className="h-full rounded-full bg-[#3b82f6] transition-all"
                          style={{
                            width: `${Math.min(w.usedPercent, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 self-start pt-[1px]">
              {statusBadge(p)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
