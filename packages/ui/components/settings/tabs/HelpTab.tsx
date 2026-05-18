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

type MiddlewareGitStatus = {
  repoRoot: string
  currentBranch?: string
  targetBranch?: string
  upstream?: string
  headSha?: string
  headSubject?: string
  remoteSha?: string
  remoteSubject?: string
  ahead?: number
  behind?: number
  dirty?: boolean
  staged?: number
  unstaged?: number
  untracked?: number
  diffSummary?: string
  checkedAt: string
  error?: string
}

type MiddlewareUpdateStatus = {
  state: "idle" | "running" | "restarting" | "succeeded" | "failed"
  startedAt?: string
  updatedAt: string
  message?: string
  repoRoot?: string
  branch?: string
  logPath?: string
  git?: MiddlewareGitStatus
}

type MiddlewareUpdateStart = {
  ok: boolean
  accepted: boolean
  message?: string
  status: MiddlewareUpdateStatus
}

const FALLBACK_UPDATE_BRANCH_OPTIONS = ["main", "dev-2-temp", "dev-2", "dev-3-harsh"] as const

type MiddlewareUpdateBranch = {
  name: string
  sha?: string
  updatedAt?: string
  url?: string
}

type MiddlewareUpdateBranchesResponse = {
  branches: MiddlewareUpdateBranch[]
  defaultBranch?: string
  source?: string
}

type SessionMigrationScan = {
  sessions?: Array<Record<string, unknown>>
  summary?: {
    total?: number
    direct?: number
    groups?: number
    topics?: number
    alreadyImported?: number
  }
  groups?: Array<{ groupId: string; name: string; topics: number }>
}

type SessionMigrationImport = {
  summary: { imported: number; skipped: number; failed: number }
  failed?: Array<{ sourceSessionKey: string; error: string }>
}

type V1SqliteMigrationImport = {
  ok: true
  sourcePath: string
  targetPath: string
  summary: {
    imported: number
    updated: number
    skipped: number
    spaces: number
    chats: number
    projects: number
    topics: number
    sessions: number
  }
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

      <V1SqliteMigrationCard />

      <SessionMigrationCard platform="telegram" />

      <SessionMigrationCard platform="discord" />
    </div>
  )
}

function MiddlewareUpdateCard() {
  const [status, setStatus] = React.useState<MiddlewareUpdateStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [needsManualBootstrap, setNeedsManualBootstrap] = React.useState(false)
  const [selectedBranch, setSelectedBranch] = React.useState<string>(FALLBACK_UPDATE_BRANCH_OPTIONS[0])
  const [customBranch, setCustomBranch] = React.useState("")
  const [branches, setBranches] = React.useState<MiddlewareUpdateBranch[]>(() => FALLBACK_UPDATE_BRANCH_OPTIONS.map((name) => ({ name })))
  const [branchesLoading, setBranchesLoading] = React.useState(false)
  const [branchesError, setBranchesError] = React.useState<string | null>(null)

  const updateBranch = selectedBranch === "custom" ? customBranch.trim() : selectedBranch

  async function refreshBranches() {
    setBranchesLoading(true)
    setBranchesError(null)
    try {
      const res = await invoke<MiddlewareUpdateBranchesResponse>("middleware_self_update_branches")
      if (Array.isArray(res.branches) && res.branches.length > 0) {
        setBranches(res.branches)
        if (!res.branches.some((branch) => branch.name === selectedBranch) && selectedBranch !== "custom") {
          setSelectedBranch(res.defaultBranch || res.branches[0]?.name || FALLBACK_UPDATE_BRANCH_OPTIONS[0])
        }
      }
    } catch (err) {
      setBranchesError(err instanceof Error ? err.message : String(err))
    } finally {
      setBranchesLoading(false)
    }
  }

  React.useEffect(() => {
    refreshBranches().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function refreshStatus(branch = updateBranch) {
    const next = await invoke<MiddlewareUpdateStatus>("middleware_self_update_status", { branch })
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
    let statusTimer: number | null = null
    try {
      if (!updateBranch) {
        setError("Choose a branch before updating Middleware.")
        return
      }
      const started = await invoke<MiddlewareUpdateStart>("middleware_self_update", { branch: updateBranch })
      setStatus(started.status)
      statusTimer = window.setInterval(() => {
        refreshStatus(updateBranch).catch(() => undefined)
      }, 2_000)
      const connected = await waitForMiddlewareBack()
      if (connected) {
        setStatus({ state: "succeeded", updatedAt: new Date().toISOString(), message: `Middleware updated from ${updateBranch} and OpenClaw is connected.`, branch: updateBranch })
      } else {
        const latest = await refreshStatus(updateBranch).catch(() => null)
        if (!latest || latest.state !== "failed") {
          setError("Update started, but Middleware did not come back healthy within 90 seconds. Check the VPS service logs.")
        }
      }
    } catch (err) {
      handleUpdateError(err)
    } finally {
      if (statusTimer !== null) window.clearInterval(statusTimer)
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
            Pick a branch, pull latest OpenClaw Desktop Middleware, rebuild it, restart the VPS service, and verify OpenClaw is connected.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-md border border-border/35 bg-background/30 p-3 sm:grid-cols-[minmax(0,220px)_1fr]">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          Update branch
          <select
            value={selectedBranch}
            onChange={(event) => setSelectedBranch(event.target.value)}
            disabled={busy}
            className="h-9 rounded-md border border-border/50 bg-background px-3 text-[12px] text-foreground outline-none transition-colors focus:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}{branch.updatedAt ? ` · ${new Date(branch.updatedAt).toLocaleDateString()}` : ""}
              </option>
            ))}
            <option value="custom">Custom branch…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          {selectedBranch === "custom" ? "Custom branch name" : "Selected branch"}
          <input
            value={selectedBranch === "custom" ? customBranch : updateBranch}
            onChange={(event) => setCustomBranch(event.target.value)}
            disabled={busy || selectedBranch !== "custom"}
            placeholder="feature/my-branch"
            className="h-9 rounded-md border border-border/50 bg-background px-3 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/65">
        <span>{branchesLoading ? "Refreshing public repo branches…" : `Showing ${branches.length} public repo branches, newest first.`}</span>
        <button
          type="button"
          onClick={() => refreshBranches().catch(() => undefined)}
          disabled={busy || branchesLoading}
          className="rounded border border-border/40 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refresh branches
        </button>
        {branchesError && <span className="text-red-400">Branch fetch failed; using fallback list.</span>}
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
          onClick={() => { setNeedsManualBootstrap(false); refreshStatus(updateBranch).catch(handleUpdateError) }}
          disabled={busy}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Check status
        </button>
      </div>

      {status?.message && (
        <div className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${success ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : failed ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-border/35 bg-background/35 text-muted-foreground"}`}>
          {success ? <LuCheck className="mt-0.5 shrink-0" size={14} /> : failed ? <LuCircleAlert className="mt-0.5 shrink-0" size={14} /> : <LuRefreshCw className="mt-0.5 shrink-0 animate-spin" size={14} />}
          <span>
            {status.message}
            {status.branch && <span className="ml-1 text-muted-foreground/70">({status.branch})</span>}
            <span className="mt-0.5 block text-[10px] text-muted-foreground/60">State: {status.state} · Updated: {new Date(status.updatedAt).toLocaleTimeString()}</span>
            {status.git && (
              <span className="mt-1 block space-y-0.5 text-[10px] text-muted-foreground/60">
                <span className="block">Local: {status.git.currentBranch ?? "unknown"} {status.git.headSha ? `@ ${status.git.headSha.slice(0, 7)}` : ""}{status.git.headSubject ? ` — ${status.git.headSubject}` : ""}</span>
                <span className="block">Remote: {status.git.upstream ?? "origin"} {status.git.remoteSha ? `@ ${status.git.remoteSha.slice(0, 7)}` : ""}{status.git.remoteSubject ? ` — ${status.git.remoteSubject}` : ""}</span>
                <span className="block">Ahead: {status.git.ahead ?? 0} · Behind: {status.git.behind ?? 0} · Dirty: {status.git.dirty ? `yes (${(status.git.staged ?? 0) + (status.git.unstaged ?? 0) + (status.git.untracked ?? 0)} files)` : "no"}</span>
                {status.git.diffSummary && <span className="block whitespace-pre-wrap rounded border border-border/25 bg-background/40 p-2 font-mono text-[10px] text-muted-foreground/75">{status.git.diffSummary}</span>}
                {status.git.error && <span className="block text-amber-400">Git status warning: {status.git.error}</span>}
              </span>
            )}
            {status.logPath && <span className="mt-0.5 block text-[10px] text-muted-foreground/60">Log: {status.logPath}</span>}
          </span>
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
            {`curl -fsSL https://raw.githubusercontent.com/Nextbasedev/openclaw-desktop/${updateBranch || "main"}/apps/middleware/scripts/install.sh | sudo OPENCLAW_DESKTOP_BRANCH=${updateBranch || "main"} bash`}
          </code>
        </div>
      )}
    </section>
  )
}

function V1SqliteMigrationCard() {
  const [result, setResult] = React.useState<V1SqliteMigrationImport | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function migrateSqlite() {
    setBusy(true)
    setError(null)
    try {
      setResult(await invoke<V1SqliteMigrationImport>("middleware_migration_v1_sqlite_import"))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border border-border/50 bg-muted/[0.03] p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <LuRefreshCw size={16} className={busy ? "animate-spin" : ""} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">SQLite v1 → v2 migration</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Migrate your local v1 Middleware SQLite data into the v2 Desktop format. This preserves existing IDs and updates matching records instead of duplicating them.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={migrateSqlite}
          disabled={busy}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LuRefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Migrating…" : "Migrate"}
        </button>
      </div>

      {result && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-400">
          <LuCheck className="mt-0.5 shrink-0" size={14} />
          <span>
            Migrated {result.summary.imported} new and {result.summary.updated} existing records from v1 SQLite.
          </span>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-border/35 bg-background/35 p-3 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Spaces" value={result.summary.spaces} />
            <Stat label="Chats" value={result.summary.chats} />
            <Stat label="Projects" value={result.summary.projects} />
            <Stat label="Topics" value={result.summary.topics} />
            <Stat label="Sessions" value={result.summary.sessions} />
          </div>
          <p className="mt-3 truncate border-t border-border/30 pt-3 text-muted-foreground/70">Source: {result.sourcePath}</p>
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

type SessionMigrationPlatform = "telegram" | "discord"

const SESSION_MIGRATION_COPY: Record<SessionMigrationPlatform, {
  title: string
  scanLabel: string
  importLabel: string
  description: string
  channelLabel: string
}> = {
  telegram: {
    title: "Telegram migration",
    scanLabel: "Scan Telegram",
    importLabel: "Import Telegram",
    description: "Import Telegram history into Desktop. Direct chats become normal chats. Groups become projects, and Telegram topics become topics inside those projects.",
    channelLabel: "Groups",
  },
  discord: {
    title: "Discord migration",
    scanLabel: "Scan Discord",
    importLabel: "Import Discord",
    description: "Import Discord history into Desktop. DMs become normal chats. Channels and threads become topics grouped inside Desktop projects.",
    channelLabel: "Channels",
  },
}

function SessionMigrationCard({ platform }: { platform: SessionMigrationPlatform }) {
  const copy = SESSION_MIGRATION_COPY[platform]
  const [scan, setScan] = React.useState<SessionMigrationScan | null>(null)
  const [result, setResult] = React.useState<SessionMigrationImport | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<"scan" | "import" | null>(null)

  async function scanSessions() {
    setBusy("scan")
    setError(null)
    setResult(null)
    try {
      setScan(await invoke<SessionMigrationScan>(`middleware_migration_${platform}_scan`))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function importSessions() {
    setBusy("import")
    setError(null)
    try {
      const imported = await invoke<SessionMigrationImport>(`middleware_migration_${platform}_import`, { input: { skipAlreadyImported: true } })
      setResult(imported)
      setScan(await invoke<SessionMigrationScan>(`middleware_migration_${platform}_scan`))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const scanSummary = {
    total: scan?.summary?.total ?? scan?.sessions?.length ?? 0,
    direct: scan?.summary?.direct ?? 0,
    groups: scan?.summary?.groups ?? scan?.groups?.length ?? 0,
    topics: scan?.summary?.topics ?? 0,
    alreadyImported: scan?.summary?.alreadyImported ?? 0,
  }
  const scanGroups = scan?.groups ?? []
  const importable = Math.max(0, scanSummary.total - scanSummary.alreadyImported)

  return (
    <section className="rounded-md border border-border/50 bg-muted/[0.03] p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <LuMessagesSquare size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">{copy.title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {copy.description}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={scanSessions}
          disabled={busy !== null}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LuRefreshCw size={13} className={busy === "scan" ? "animate-spin" : ""} />
          {busy === "scan" ? "Scanning…" : copy.scanLabel}
        </button>
        <button
          type="button"
          onClick={importSessions}
          disabled={busy !== null || !scan || importable === 0}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "import" ? "Importing…" : copy.importLabel}
        </button>
      </div>

      {scan && (
        <div className="mt-4 rounded-md border border-border/35 bg-background/35 p-3 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Sessions" value={scanSummary.total} />
            <Stat label="Direct" value={scanSummary.direct} />
            <Stat label={copy.channelLabel} value={scanSummary.groups} />
            <Stat label="Topics" value={scanSummary.topics} />
            <Stat label="Imported" value={scanSummary.alreadyImported} />
          </div>
          {scanGroups.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border/30 pt-3">
              {scanGroups.slice(0, 5).map((group) => (
                <div key={group.groupId} className="flex items-center justify-between gap-3">
                  <span className="truncate text-foreground/80">{group.name}</span>
                  <span className="shrink-0 text-muted-foreground/70">{group.topics} topics</span>
                </div>
              ))}
              {scanGroups.length > 5 && <p className="text-muted-foreground/60">+{scanGroups.length - 5} more groups</p>}
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
