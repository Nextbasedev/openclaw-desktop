import { useState, useEffect } from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { CoreStatus } from "../useOnboardingFlow"

type Props = {
  checkCore: (action: "check" | "apply") => Promise<{
    action: string
    applied: boolean
    canAutoFix: boolean
    status: CoreStatus
    actionsRun: string[]
    message?: string
    manualAction?: string
    docsUrl?: string
  }>
  onComplete: () => void
}

type CheckItem = {
  label: string
  installed: boolean
  version: string | null
  helpUrl?: string
}

const GUIDANCE: Record<string, { title: string; hint: string }> = {
  install_node: {
    title: "Node.js is required",
    hint: "Download and install Node.js (v18+) from nodejs.org, then click Re-check.",
  },
  install_npm: {
    title: "npm is required",
    hint: "npm ships with Node.js — try reinstalling Node, then click Re-check.",
  },
  install_openclaw: {
    title: "OpenClaw CLI needed",
    hint: "Click Auto-fix to install it automatically via npm.",
  },
  start_gateway: {
    title: "Gateway not running",
    hint: "Click Auto-fix to start the OpenClaw gateway.",
  },
}

export function CoreSetupStep({ checkCore, onComplete }: Props) {
  const [status, setStatus] = useState<CoreStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionsRun, setActionsRun] = useState<string[]>([])
  const [skipConfirm, setSkipConfirm] = useState(false)

  useEffect(() => {
    runCheck()
  }, [])

  async function runCheck() {
    setLoading(true)
    setError(null)
    try {
      const result = await checkCore("check")
      setStatus(result.status)
      if (result.status.recommendation === "ready") {
        setTimeout(onComplete, 800)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleAutoFix() {
    setApplying(true)
    setError(null)
    setActionsRun([])
    try {
      const result = await checkCore("apply")
      setStatus(result.status)
      setActionsRun(result.actionsRun)
      if (result.message) {
        setError(result.message)
      }
      if (result.status.recommendation === "ready") {
        setTimeout(onComplete, 1000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  const items: CheckItem[] = status
    ? [
        {
          label: "Node.js",
          installed: status.node.installed,
          version: status.node.version,
          helpUrl: "https://nodejs.org",
        },
        {
          label: "npm",
          installed: status.npm.installed,
          version: status.npm.version,
          helpUrl: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm",
        },
        {
          label: "OpenClaw CLI",
          installed: status.openclaw.installed,
          version: status.openclaw.version,
        },
        {
          label: "Gateway",
          installed: status.gateway.running,
          version: status.gateway.running ? status.gateway.url : null,
        },
      ]
    : []

  const recommendation = status?.recommendation || ""
  const guide = GUIDANCE[recommendation]
  const canAutoFix = status && status.node.installed && recommendation !== "ready"
  const allReady = recommendation === "ready"

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/5">
          <Icons.Terminal size={20} className="text-foreground/70" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">System Setup</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Checking dependencies and starting the OpenClaw runtime
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="relative flex size-10 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-foreground/5" />
            <Icons.Refresh size={18} className="animate-spin text-muted-foreground" />
          </div>
          <span className="text-[13px] text-muted-foreground">Detecting system dependencies...</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex items-center justify-between rounded-xl px-4 py-3 transition-colors",
                item.installed
                  ? "bg-emerald-500/[0.06]"
                  : "bg-destructive/[0.04]",
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full transition-all",
                    item.installed
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {item.installed ? (
                    <Icons.Check size={12} strokeWidth={2.5} />
                  ) : (
                    <Icons.Close size={10} strokeWidth={2.5} />
                  )}
                </div>
                <span className="text-[13px] font-medium">{item.label}</span>
              </div>
              <div className="flex items-center gap-2">
                {item.installed ? (
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                    {item.version || "OK"}
                  </span>
                ) : (
                  <>
                    <span className="text-[11px] text-muted-foreground">Missing</span>
                    {item.helpUrl && (
                      <a
                        href={item.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-md bg-foreground/5 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                      >
                        Install
                        <Icons.ExternalLink size={9} />
                      </a>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && guide && (
        <div className="rounded-xl bg-muted/40 px-4 py-3">
          <p className="text-[13px] font-medium text-foreground">{guide.title}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{guide.hint}</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-destructive/[0.06] px-4 py-3">
          <p className="text-[13px] text-destructive">{error}</p>
        </div>
      )}

      {actionsRun.length > 0 && (
        <div className="rounded-xl bg-muted/30 px-4 py-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Actions performed
          </p>
          {actionsRun.map((action) => (
            <p key={action} className="font-mono text-[11px] text-foreground/70">
              $ {action}
            </p>
          ))}
        </div>
      )}

      {!loading && !allReady && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={runCheck}
            disabled={applying}
            className="rounded-lg bg-foreground/5 px-4 py-2 text-[13px] font-medium text-foreground transition-all hover:bg-foreground/10 active:scale-[0.98] disabled:opacity-50"
          >
            Re-check
          </button>
          {canAutoFix && (
            <button
              onClick={handleAutoFix}
              disabled={applying}
              className="rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-all hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
            >
              {applying ? (
                <span className="flex items-center gap-2">
                  <Icons.Refresh size={13} className="animate-spin" />
                  Installing...
                </span>
              ) : (
                "Auto-fix"
              )}
            </button>
          )}
          {!skipConfirm ? (
            <button
              onClick={() => setSkipConfirm(true)}
              className="ml-auto text-[13px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              Skip
            </button>
          ) : (
            <button
              onClick={onComplete}
              className="ml-auto text-[13px] text-destructive/60 transition-colors hover:text-destructive"
            >
              Skip anyway
            </button>
          )}
        </div>
      )}

      {allReady && (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/[0.06] py-3">
          <Icons.Check size={15} className="text-emerald-500" />
          <span className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
            All checks passed
          </span>
        </div>
      )}
    </div>
  )
}
