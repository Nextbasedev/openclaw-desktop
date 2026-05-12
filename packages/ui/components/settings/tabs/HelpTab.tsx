"use client"

import * as React from "react"
import { invoke, openExternalUrl } from "@/lib/ipc"
import { getMiddlewareConnection, isOpenClawConnected, testMiddlewareConnection } from "@/lib/middleware-client"
import { LuGithub, LuKeyboard, LuExternalLink, LuRefreshCw, LuMessagesSquare, LuCheck, LuCircleAlert } from "react-icons/lu"

type HelpLink = {
  label: string
  description: string
  url: string
  icon: React.ElementType
}

const HELP_LINKS: HelpLink[] = [
  { label: "GitHub", description: "Report issues and view source", url: "https://github.com/Nextbasedev/openclaw-desktop", icon: LuGithub },
  { label: "Keyboard Shortcuts", description: "View all shortcuts", url: "#", icon: LuKeyboard },
]

type HelpTabProps = {
  links?: HelpLink[]
  onShortcutsClick?: () => void
}

type MiddlewareUpdateStatus = {
  state: "idle" | "running" | "restarting" | "succeeded" | "failed"
  startedAt?: string
  updatedAt: string
  message?: string
  repoRoot?: string
  branch?: string
  logPath?: string
}

type MiddlewareUpdateStart = {
  ok: boolean
  accepted: boolean
  message?: string
  status: MiddlewareUpdateStatus
}

type TelegramMigrationScan = {
  summary: {
    total: number
    direct: number
    groups: number
    topics: number
    alreadyImported: number
  }
  groups: Array<{ groupId: string; name: string; topics: number }>
}

type TelegramMigrationImport = {
  summary: { imported: number; skipped: number; failed: number }
  failed?: Array<{ sourceSessionKey: string; error: string }>
}

export function HelpTab({ links = HELP_LINKS, onShortcutsClick }: HelpTabProps) {
  function handleClick(link: HelpLink) {
    if (link.label === "Keyboard Shortcuts" && onShortcutsClick) {
      onShortcutsClick()
      return
    }
    if (link.url === "#") return
    openExternalUrl(link.url).catch(() => {
      window.open(link.url, "_blank")
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-muted-foreground">Help</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resources and support for OpenClaw Desktop.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border/50 ">
        {links.map((link, idx) => {
          const Icon = link.icon
          const isExternal = link.url.startsWith("http")
          return (
            <button
              key={link.label}
              type="button"
              onClick={() => handleClick(link)}
              className={`flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/20 ${idx > 0 ? "border-t border-border/30" : ""}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                <Icon size={15} />
              </span>
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-foreground">{link.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{link.description}</span>
              </div>
              {isExternal && (
                <span className="text-muted-foreground/50">
                  <LuExternalLink size={14} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <MiddlewareUpdateCard />

      <TelegramMigrationCard />
    </div>
  )
}

function MiddlewareUpdateCard() {
  const [status, setStatus] = React.useState<MiddlewareUpdateStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [needsManualBootstrap, setNeedsManualBootstrap] = React.useState(false)

  async function waitForMiddlewareBack() {
    const connection = getMiddlewareConnection()
    if (!connection) return false
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      try {
        const health = await testMiddlewareConnection(connection)
        if (health.ok && isOpenClawConnected(health)) return true
      } catch {}
      await new Promise((resolve) => window.setTimeout(resolve, 2_000))
    }
    return false
  }

  async function refreshStatus() {
    const next = await invoke<MiddlewareUpdateStatus>("middleware_self_update_status")
    setStatus(next)
    return next
  }

  function handleUpdateError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Route not found|404|middleware\/update/i.test(message)) {
      setNeedsManualBootstrap(true)
      setError("This VPS is running an older Middleware that cannot self-update yet. Run the one-time install/update command below, then this button will work for future updates.")
      return
    }
    setError(message)
  }

  async function updateMiddleware() {
    setBusy(true)
    setError(null)
    setNeedsManualBootstrap(false)
    try {
      const started = await invoke<MiddlewareUpdateStart>("middleware_self_update")
      setStatus(started.status)
      const connected = await waitForMiddlewareBack()
      if (connected) {
        setStatus({ state: "succeeded", updatedAt: new Date().toISOString(), message: "Middleware updated and OpenClaw is connected.", branch: "main" })
      } else {
        const latest = await refreshStatus().catch(() => null)
        if (!latest || latest.state !== "failed") {
          setError("Update started, but Middleware did not come back healthy within 90 seconds. Check the VPS service logs.")
        }
      }
    } catch (err) {
      handleUpdateError(err)
    } finally {
      setBusy(false)
    }
  }

  const success = status?.state === "succeeded"
  const failed = status?.state === "failed" || error

  return (
    <section className="rounded-md border border-border/50 bg-muted/[0.03] p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <LuRefreshCw size={16} className={busy ? "animate-spin" : ""} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">VPS Middleware update</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Pull latest OpenClaw Desktop Middleware from <span className="text-foreground/80">main</span>, rebuild it, restart the VPS service, and verify OpenClaw is connected.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={updateMiddleware}
          disabled={busy}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LuRefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Updating…" : "Update Middleware"}
        </button>
        <button
          type="button"
          onClick={() => { setNeedsManualBootstrap(false); refreshStatus().catch(handleUpdateError) }}
          disabled={busy}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Check status
        </button>
      </div>

      {status?.message && (
        <div className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${success ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : failed ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-border/35 bg-background/35 text-muted-foreground"}`}>
          {success ? <LuCheck className="mt-0.5 shrink-0" size={14} /> : failed ? <LuCircleAlert className="mt-0.5 shrink-0" size={14} /> : <LuRefreshCw className="mt-0.5 shrink-0" size={14} />}
          <span>{status.message}</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          <LuCircleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{error}</span>
        </div>
      )}

      {needsManualBootstrap && (
        <div className="mt-3 rounded-md border border-border/35 bg-background/35 p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">Run this once on the VPS:</p>
          <code className="mt-2 block overflow-x-auto rounded bg-muted/40 px-3 py-2 text-[11px] text-foreground">
            curl -fsSL https://raw.githubusercontent.com/Nextbasedev/openclaw-desktop/main/apps/middleware/scripts/install.sh | sudo bash
          </code>
        </div>
      )}
    </section>
  )
}

function TelegramMigrationCard() {
  const [scan, setScan] = React.useState<TelegramMigrationScan | null>(null)
  const [result, setResult] = React.useState<TelegramMigrationImport | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<"scan" | "import" | null>(null)

  async function scanTelegram() {
    setBusy("scan")
    setError(null)
    setResult(null)
    try {
      setScan(await invoke<TelegramMigrationScan>("middleware_migration_telegram_scan"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function importTelegram() {
    setBusy("import")
    setError(null)
    try {
      const imported = await invoke<TelegramMigrationImport>("middleware_migration_telegram_import", { input: { skipAlreadyImported: true } })
      setResult(imported)
      setScan(await invoke<TelegramMigrationScan>("middleware_migration_telegram_scan"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const importable = scan ? Math.max(0, scan.summary.total - scan.summary.alreadyImported) : 0

  return (
    <section className="rounded-md border border-border/50 bg-muted/[0.03] p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <LuMessagesSquare size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">Telegram migration</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Import Telegram history into Desktop. Direct chats become normal chats. Groups become projects, and Telegram topics become topics inside those projects.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={scanTelegram}
          disabled={busy !== null}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LuRefreshCw size={13} className={busy === "scan" ? "animate-spin" : ""} />
          {busy === "scan" ? "Scanning…" : "Scan Telegram"}
        </button>
        <button
          type="button"
          onClick={importTelegram}
          disabled={busy !== null || !scan || importable === 0}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "import" ? "Importing…" : "Import Telegram"}
        </button>
      </div>

      {scan && (
        <div className="mt-4 rounded-md border border-border/35 bg-background/35 p-3 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Sessions" value={scan.summary.total} />
            <Stat label="Direct" value={scan.summary.direct} />
            <Stat label="Groups" value={scan.summary.groups} />
            <Stat label="Topics" value={scan.summary.topics} />
            <Stat label="Imported" value={scan.summary.alreadyImported} />
          </div>
          {scan.groups.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border/30 pt-3">
              {scan.groups.slice(0, 5).map((group) => (
                <div key={group.groupId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-foreground/80">{group.name}</span>
                  <span className="shrink-0 text-muted-foreground/70">{group.topics} topics</span>
                </div>
              ))}
              {scan.groups.length > 5 && <p className="text-muted-foreground/60">+{scan.groups.length - 5} more groups</p>}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-400">
          <LuCheck className="mt-0.5 shrink-0" size={14} />
          <span>Imported {result.summary.imported}, skipped {result.summary.skipped}, failed {result.summary.failed}.</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          <LuCircleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{error}</span>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[14px] font-semibold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{label}</div>
    </div>
  )
}
