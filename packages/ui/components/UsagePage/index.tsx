"use client"

import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

/* ── Dummy data (will be replaced by API later) ── */

type UsageLimit = {
  label: string
  resetLabel: string
  used: number
  total: number
}

type CreditSection = {
  label: string
  description: string
  action: string
}

const USAGE_LIMITS: UsageLimit[] = [
  { label: "5 hour usage limit", resetLabel: "Resets 5:46 PM", used: 0, total: 100 },
  { label: "Weekly usage limit", resetLabel: "Resets Apr 21", used: 100, total: 100 },
]

const CREDITS: CreditSection[] = [
  {
    label: "0 credit remaining",
    description: "Use credit to send messages when you reach usage limits.",
    action: "Purchase",
  },
  {
    label: "Auto-reload credit",
    description: "Automatically add credit when you reach your minimum balance.",
    action: "Settings",
  },
]

type UsagePageProps = {
  onBack?: () => void
}

export function UsagePage({ onBack }: UsagePageProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">


      {/* Title */}
      <h1 className="mb-8 text-2xl font-semibold text-foreground">Usage</h1>

      {/* General usage limits */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          General usage limits
        </h2>

        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          {USAGE_LIMITS.map((limit, idx) => {
            const percentLeft =
              limit.total > 0
                ? Math.round(((limit.total - limit.used) / limit.total) * 100)
                : 0

            return (
              <div
                key={limit.label}
                className={cn(
                  "flex items-center justify-between px-5 py-4",
                  idx > 0 && "border-t border-border/30",
                )}
              >
                {/* Left: label + reset */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {limit.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {limit.resetLabel}
                  </span>
                </div>

                {/* Right: progress bar + percentage */}
                <div className="flex items-center gap-3">
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        percentLeft > 50
                          ? "bg-foreground"
                          : percentLeft > 20
                            ? "bg-muted-foreground"
                            : "bg-muted-foreground/40",
                      )}
                      style={{ width: `${percentLeft}%` }}
                    />
                  </div>
                  <span className="min-w-[52px] text-right text-sm text-muted-foreground">
                    {percentLeft}% left
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Credit section */}
      <section>
        <h2 className="mb-4 text-sm font-semibold text-foreground">Credit</h2>

        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          {CREDITS.map((credit, idx) => (
            <div
              key={credit.label}
              className={cn(
                "flex items-center justify-between px-5 py-4",
                idx > 0 && "border-t border-border/30",
              )}
            >
              {/* Left: label + description */}
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {credit.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {credit.description}{" "}
                  {idx === 0 && (
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-0.5 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                    >
                      Doc ↗
                    </button>
                  )}
                </span>
              </div>

              {/* Right: action button */}
              <button
                type="button"
                className={cn(
                  "cursor-pointer rounded-lg border border-border/60 bg-secondary/40 px-4 py-1.5",
                  "text-xs font-medium text-foreground transition-colors",
                  "hover:bg-secondary/80",
                )}
              >
                {credit.action}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
