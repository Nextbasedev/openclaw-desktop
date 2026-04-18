import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Icons } from "@/components/icons"
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
      <div>
        <h2 className="text-xl font-semibold tracking-tight">System Setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Checking dependencies and starting the OpenClaw runtime.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-5 py-8">
          <Icons.Refresh size={16} className="animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Detecting system dependencies...</span>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-lg border border-border/40 bg-card/50 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {item.installed ? (
                  <div className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
                    <Icons.Check size={12} strokeWidth={2.5} />
                  </div>
                ) : (
                  <div className="flex size-5 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <Icons.Close size={12} strokeWidth={2.5} />
                  </div>
                )}
                <span className="text-[13px] font-medium">{item.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {item.installed
                    ? item.version || "OK"
                    : item.helpUrl
                      ? "Not found"
                      : "Not installed"}
                </span>
                {!item.installed && item.helpUrl && (
                  <a
                    href={item.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground underline decoration-muted-foreground/40 transition-colors hover:text-foreground"
                  >
                    Install
                    <Icons.ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && guide && (
        <div className="rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
          <p className="text-[13px] font-medium text-foreground">{guide.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{guide.hint}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {actionsRun.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-card/50 px-4 py-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Actions performed:</p>
          {actionsRun.map((action) => (
            <p key={action} className="font-mono text-xs text-foreground/80">
              $ {action}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        {!loading && !allReady && (
          <>
            <Button variant="outline" size="sm" onClick={runCheck} disabled={applying}>
              Re-check
            </Button>
            {canAutoFix && (
              <Button size="sm" onClick={handleAutoFix} disabled={applying}>
                {applying ? (
                  <>
                    <Icons.Refresh size={14} className="animate-spin" />
                    Installing...
                  </>
                ) : (
                  "Auto-fix"
                )}
              </Button>
            )}
            {!skipConfirm ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkipConfirm(true)}
                className="ml-auto text-muted-foreground"
              >
                Skip for now
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onComplete}
                className="ml-auto text-destructive/70 hover:text-destructive"
              >
                Skip — some features won't work
              </Button>
            )}
          </>
        )}
        {allReady && (
          <div className="flex items-center gap-3">
            <Icons.Check size={16} className="text-emerald-500" />
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              All checks passed
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
