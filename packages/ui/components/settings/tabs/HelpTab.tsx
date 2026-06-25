"use client"

import * as React from "react"
import { toast } from "react-toastify"
import { invoke, openExternalUrl } from "@/lib/ipc"
import { emit } from "@/lib/events"
import { invalidateMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import { getMiddlewareConnection, isOpenClawConnected, testMiddlewareConnection } from "@/lib/middleware-client"
import { LuGithub, LuKeyboard, LuExternalLink, LuRefreshCw, LuMessagesSquare, LuCheck, LuCircleAlert, LuChevronDown, LuSparkles } from "react-icons/lu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

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

const HELP_SECTION_CLASS = "rounded-2xl bg-black/[0.025] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.70)] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
const HELP_ICON_CLASS = "flex size-8 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-muted-foreground dark:bg-white/[0.055]"
const HELP_FIELD_CLASS = "h-9 rounded-xl bg-black/[0.04] px-3 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 hover:bg-black/[0.055] focus:bg-black/[0.065] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-black/20 dark:hover:bg-white/[0.045] dark:focus:bg-white/[0.065]"
const HELP_SECONDARY_BUTTON_CLASS = "inline-flex cursor-pointer items-center gap-2 rounded-xl bg-black/[0.045] px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-black/[0.065] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/[0.055] dark:hover:bg-white/[0.085]"
const HELP_PRIMARY_BUTTON_CLASS = "inline-flex cursor-pointer items-center gap-2 rounded-xl bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"

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

function middlewareUpdateToastMessage(status: MiddlewareUpdateStatus) {
  const branch = status.branch ? ` ${status.branch}` : ""
  if (status.state === "running") return `Updating Middleware${branch}…`
  if (status.state === "restarting") return "Build complete. Restarting Middleware service…"
  if (status.state === "succeeded") return "Middleware updated and connected."
  if (status.state === "failed") return "Middleware update failed."
  return status.git ? middlewareGitStatusToastMessage(status.git) : "Middleware update status refreshed."
}

function middlewareGitStatusToastMessage(git: MiddlewareGitStatus) {
  if ((git.behind ?? 0) > 0) return `Update available: ${git.behind} commit${git.behind === 1 ? "" : "s"} behind ${git.upstream ?? "remote"}.`
  if (git.remoteSha && git.remoteSha !== git.headSha) return `Update available: ${git.currentBranch ?? "current branch"} → ${git.upstream ?? "remote"}.`
  if (git.error) return `Middleware status warning: ${git.error}`
  return "Middleware is up to date."
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

type AiChatTitlesSettingsResponse = {
  settings: {
    enabled: boolean
    provider?: AiChatTitleProvider
    apiKeyConfigured: boolean
    model?: string
  }
}

type AiChatTitleProvider = "openai-compatible" | "xai"

const AI_CHAT_TITLE_PROVIDER_OPTIONS: Array<{ value: AiChatTitleProvider; label: string; defaultModel: string; keyLabel: string; hint: string }> = [
  {
    value: "openai-compatible",
    label: "OpenAI-compatible / GPT OSS",
    defaultModel: "gpt-oss-20b",
    keyLabel: "GPT OSS API key",
    hint: "Uses the OpenAI-compatible chat completions endpoint.",
  },
  {
    value: "xai",
    label: "xAI / Grok",
    defaultModel: "grok-3-mini",
    keyLabel: "xAI/Grok API key",
    hint: "Uses xAI's Grok chat completions endpoint automatically.",
  },
]

const AI_CHAT_TITLE_DEFAULT_MODELS = AI_CHAT_TITLE_PROVIDER_OPTIONS.map((option) => option.defaultModel)

function aiChatTitleProviderOption(provider: AiChatTitleProvider) {
  return AI_CHAT_TITLE_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? AI_CHAT_TITLE_PROVIDER_OPTIONS[0]
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
        <h2 className="text-lg font-semibold text-foreground">Help</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resources and support for OpenClaw Desktop.
        </p>
      </div>

      <div className="space-y-1.5">
        {links.map((link) => {
          const Icon = link.icon
          const isExternal = link.url.startsWith("http")
          return (
            <button
              key={link.label}
              type="button"
              onClick={() => handleClick(link)}
              className="flex w-full cursor-pointer items-center gap-4 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.045]"
            >
              <span className={HELP_ICON_CLASS}>
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

      <AiChatTitlesCard />

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
  const [branchMenuOpen, setBranchMenuOpen] = React.useState(false)
  const lastToastMessageRef = React.useRef<string | null>(null)

  const updateBranch = selectedBranch === "custom" ? customBranch.trim() : selectedBranch

  function updateMiddlewareToast(next: MiddlewareUpdateStatus, options: { done?: boolean } = {}) {
    const message = next.message || middlewareUpdateToastMessage(next)
    if (!message || (!options.done && lastToastMessageRef.current === message)) return
    lastToastMessageRef.current = message
    if (!toast.isActive("middleware-self-update")) {
      toast.loading(message, {
        toastId: "middleware-self-update",
        autoClose: false,
        closeOnClick: false,
      })
    }
    toast.update("middleware-self-update", {
      render: message,
      type: next.state === "failed" ? "error" : next.state === "succeeded" ? "success" : "info",
      isLoading: next.state === "running" || next.state === "restarting",
      autoClose: options.done || next.state === "failed" || next.state === "succeeded" ? 6000 : false,
      closeOnClick: next.state === "failed" || next.state === "succeeded",
    })
  }

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
    if (busy || next.state === "running" || next.state === "restarting") updateMiddlewareToast(next)
    return next
  }

  function handleUpdateError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Route not found|404|middleware\/update/i.test(message)) {
      setNeedsManualBootstrap(true)
      setError("This VPS is running an older Middleware that cannot self-update yet. Run the one-time install/update command below, then this button will work for future updates.")
      toast.update("middleware-self-update", {
        render: "This Middleware is too old for self-update. Run the one-time install command below.",
        type: "error",
        isLoading: false,
        autoClose: 7000,
      })
      return
    }
    setError(message)
    toast.update("middleware-self-update", {
      render: message,
      type: "error",
      isLoading: false,
      autoClose: 7000,
    })
  }

  async function updateMiddleware() {
    setBusy(true)
    setError(null)
    setNeedsManualBootstrap(false)
    let statusTimer: number | null = null
    try {
      if (!updateBranch) {
        setError("Choose a branch before updating Middleware.")
        toast.error("Choose a branch before updating Middleware.")
        return
      }
      lastToastMessageRef.current = null
      toast.loading(`Starting Middleware update from ${updateBranch}…`, {
        toastId: "middleware-self-update",
        autoClose: false,
        closeOnClick: false,
      })
      const started = await invoke<MiddlewareUpdateStart>("middleware_self_update", { branch: updateBranch })
      setStatus(started.status)
      updateMiddlewareToast(started.status)
      if (!started.accepted) {
        updateMiddlewareToast(started.status, { done: true })
        return
      }
      statusTimer = window.setInterval(() => {
        refreshStatus(updateBranch).catch(() => undefined)
      }, 2_000)
      const connected = await waitForMiddlewareBack()
      if (connected) {
        const doneStatus: MiddlewareUpdateStatus = { state: "succeeded", updatedAt: new Date().toISOString(), message: `Middleware updated from ${updateBranch} and OpenClaw is connected.`, branch: updateBranch }
        setStatus(doneStatus)
        updateMiddlewareToast(doneStatus, { done: true })
      } else {
        const latest = await refreshStatus(updateBranch).catch(() => null)
        if (!latest || latest.state !== "failed") {
          const timeoutMessage = "Update started, but Middleware did not come back healthy within 90 seconds. Check the VPS service logs."
          setError(timeoutMessage)
          toast.update("middleware-self-update", {
            render: timeoutMessage,
            type: "error",
            isLoading: false,
            autoClose: 7000,
          })
        } else {
          updateMiddlewareToast(latest, { done: true })
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
    <section className={HELP_SECTION_CLASS}>
      <div className="flex items-start gap-4">
        <span className={HELP_ICON_CLASS}>
          <LuRefreshCw size={16} className={busy ? "animate-spin" : ""} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">VPS Middleware update</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Pick a branch, pull latest OpenClaw Desktop Middleware, rebuild it, restart the VPS service, and verify OpenClaw is connected.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-black/15 p-3 sm:grid-cols-[minmax(0,220px)_1fr]">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          Update branch
          <Popover open={branchMenuOpen} onOpenChange={setBranchMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={busy}
                className={cn(HELP_FIELD_CLASS, "flex w-full cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60")}
              >
                <span className="min-w-0 truncate">{selectedBranch === "custom" ? "Custom branch…" : selectedBranch}</span>
                <LuChevronDown size={14} className={cn("shrink-0 text-muted-foreground/70 transition-transform", branchMenuOpen && "rotate-180")} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className={cn(
                "w-[min(340px,var(--radix-popover-content-available-width))] gap-0 overflow-hidden rounded-2xl p-1.5 ring-0",
                "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
                "backdrop-blur-[40px] backdrop-saturate-[180%]",
                "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
              )}
            >
              <div
                className="max-h-72 overflow-y-scroll overscroll-contain pr-1"
                onWheel={(event) => event.stopPropagation()}
              >
                {branches.map((branch) => {
                  const active = selectedBranch === branch.name
                  return (
                    <button
                      key={branch.name}
                      type="button"
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[12px] text-foreground transition-colors",
                        active ? "bg-black/[0.055] dark:bg-white/[0.075]" : "hover:bg-black/[0.045] dark:hover:bg-white/[0.055]",
                      )}
                      onClick={() => {
                        setSelectedBranch(branch.name)
                        setBranchMenuOpen(false)
                      }}
                    >
                      <span className="min-w-0 truncate">{branch.name}</span>
                      {branch.updatedAt && <span className="shrink-0 text-[10px] text-muted-foreground/55">{new Date(branch.updatedAt).toLocaleDateString()}</span>}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className={cn(
                    "mt-1 flex w-full cursor-pointer items-center rounded-xl px-3 py-2 text-left text-[12px] text-foreground transition-colors",
                    selectedBranch === "custom" ? "bg-black/[0.055] dark:bg-white/[0.075]" : "hover:bg-black/[0.045] dark:hover:bg-white/[0.055]",
                  )}
                  onClick={() => {
                    setSelectedBranch("custom")
                    setBranchMenuOpen(false)
                  }}
                >
                  Custom branch…
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          {selectedBranch === "custom" ? "Custom branch name" : "Selected branch"}
          <input
            value={selectedBranch === "custom" ? customBranch : updateBranch}
            onChange={(event) => setCustomBranch(event.target.value)}
            disabled={busy || selectedBranch !== "custom"}
            placeholder="feature/my-branch"
            className={HELP_FIELD_CLASS}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/65">
        <span>{branchesLoading ? "Refreshing public repo branches…" : `Showing ${branches.length} public repo branches, newest first.`}</span>
        <button
          type="button"
          onClick={() => refreshBranches().catch(() => undefined)}
          disabled={busy || branchesLoading}
          className="rounded-lg bg-black/[0.04] dark:bg-white/[0.045] px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-black/[0.055] dark:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-60"
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
          className={HELP_PRIMARY_BUTTON_CLASS}
        >
          <LuRefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Updating…" : "Update Middleware"}
        </button>
        <button
          type="button"
          onClick={() => { setNeedsManualBootstrap(false); refreshStatus(updateBranch).catch(handleUpdateError) }}
          disabled={busy}
          className={HELP_SECONDARY_BUTTON_CLASS}
        >
          Check status
        </button>
      </div>

      {status?.message && (
        <div className={`mt-3 flex items-start gap-2 rounded-2xl px-3 py-2 text-[12px] ${success ? "bg-emerald-500/10 text-emerald-400" : failed ? "bg-red-500/10 text-red-400" : "bg-black/[0.04] dark:bg-white/[0.045] text-muted-foreground"}`}>
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
                {status.git.diffSummary && <span className="block whitespace-pre-wrap rounded-xl bg-black/20 p-2 font-mono text-[10px] text-muted-foreground/75">{status.git.diffSummary}</span>}
                {status.git.error && <span className="block text-amber-400">Git status warning: {status.git.error}</span>}
              </span>
            )}
            {status.logPath && <span className="mt-0.5 block text-[10px] text-muted-foreground/60">Log: {status.logPath}</span>}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          <LuCircleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{error}</span>
        </div>
      )}

      {needsManualBootstrap && (
        <div className="mt-3 rounded-2xl bg-black/[0.04] dark:bg-white/[0.045] p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">Run this once on the VPS:</p>
          <code className="mt-2 block overflow-x-auto rounded-xl bg-black/20 px-3 py-2 text-[11px] text-foreground">
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
    <section className={HELP_SECTION_CLASS}>
      <div className="flex items-start gap-4">
        <span className={HELP_ICON_CLASS}>
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
          className={HELP_PRIMARY_BUTTON_CLASS}
        >
          <LuRefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Migrating…" : "Migrate"}
        </button>
      </div>

      {result && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-400">
          <LuCheck className="mt-0.5 shrink-0" size={14} />
          <span>
            Migrated {result.summary.imported} new and {result.summary.updated} existing records from v1 SQLite.
          </span>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-2xl bg-black/[0.04] dark:bg-white/[0.045] p-3 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Spaces" value={result.summary.spaces} />
            <Stat label="Chats" value={result.summary.chats} />
            <Stat label="Projects" value={result.summary.projects} />
            <Stat label="Topics" value={result.summary.topics} />
            <Stat label="Sessions" value={result.summary.sessions} />
          </div>
          <p className="mt-3 truncate pt-3 text-muted-foreground/70">Source: {result.sourcePath}</p>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          <LuCircleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{error}</span>
        </div>
      )}
    </section>
  )
}

function AiChatTitlesCard() {
  const [enabled, setEnabled] = React.useState(false)
  const [provider, setProvider] = React.useState<AiChatTitleProvider>("openai-compatible")
  const [apiKey, setApiKey] = React.useState("")
  const [apiKeyConfigured, setApiKeyConfigured] = React.useState(false)
  const [model, setModel] = React.useState("gpt-oss-20b")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  async function loadSettings() {
    try {
      const res = await invoke<AiChatTitlesSettingsResponse>("middleware_ai_chat_titles_get")
      const nextProvider = res.settings.provider === "xai" ? "xai" : "openai-compatible"
      setEnabled(Boolean(res.settings.enabled))
      setProvider(nextProvider)
      setApiKeyConfigured(Boolean(res.settings.apiKeyConfigured))
      setModel(res.settings.model || aiChatTitleProviderOption(nextProvider).defaultModel)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  React.useEffect(() => {
    loadSettings().catch(() => undefined)
  }, [])

  async function saveSettings(nextEnabled = enabled) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const input: Record<string, unknown> = { enabled: nextEnabled, provider, model }
      if (apiKey.trim()) input.apiKey = apiKey.trim()
      const res = await invoke<AiChatTitlesSettingsResponse>("middleware_ai_chat_titles_set", { input })
      const nextProvider = res.settings.provider === "xai" ? "xai" : "openai-compatible"
      setEnabled(Boolean(res.settings.enabled))
      setProvider(nextProvider)
      setApiKeyConfigured(Boolean(res.settings.apiKeyConfigured))
      setModel(res.settings.model || model || aiChatTitleProviderOption(nextProvider).defaultModel)
      setApiKey("")
      setSaved(true)
      toast.success("AI chat title settings saved.")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  async function clearKey() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await invoke<AiChatTitlesSettingsResponse>("middleware_ai_chat_titles_set", { input: { enabled: false, provider, apiKey: "", model } })
      const nextProvider = res.settings.provider === "xai" ? "xai" : "openai-compatible"
      setEnabled(Boolean(res.settings.enabled))
      setProvider(nextProvider)
      setApiKeyConfigured(Boolean(res.settings.apiKeyConfigured))
      setApiKey("")
      setSaved(true)
      toast.success("AI chat title API key cleared.")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const canEnable = apiKeyConfigured || apiKey.trim().length > 0
  const selectedProvider = aiChatTitleProviderOption(provider)

  function handleProviderChange(nextProvider: AiChatTitleProvider) {
    setProvider(nextProvider)
    const nextDefaultModel = aiChatTitleProviderOption(nextProvider).defaultModel
    if (!model.trim() || AI_CHAT_TITLE_DEFAULT_MODELS.includes(model.trim())) {
      setModel(nextDefaultModel)
    }
  }

  return (
    <section className={HELP_SECTION_CLASS}>
      <div className="flex items-start gap-4">
        <span className={HELP_ICON_CLASS}>
          <LuSparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">AI Generated Chat Titles</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Use an AI model to name newly created chats from the first user prompt. If this is off or no key is configured, OpenClaw keeps the current first-prompt truncation fallback.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-black/15 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(150px,210px)]">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          Provider
          <select
            value={provider}
            onChange={(event) => handleProviderChange(event.target.value === "xai" ? "xai" : "openai-compatible")}
            disabled={busy}
            className={HELP_FIELD_CLASS}
          >
            {AI_CHAT_TITLE_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          {selectedProvider.keyLabel}
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy}
            placeholder={apiKeyConfigured ? "Configured — enter a new key to replace" : `Enter ${selectedProvider.keyLabel}`}
            className={HELP_FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          Model
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={busy}
            placeholder={selectedProvider.defaultModel}
            className={HELP_FIELD_CLASS}
          />
        </label>
      </div>
      <p className="mt-2 px-1 text-[10px] leading-relaxed text-muted-foreground/65">
        {selectedProvider.hint}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || (!enabled && !canEnable)}
            onChange={(event) => saveSettings(event.target.checked)}
            className="size-4 accent-foreground"
          />
          Enable AI-generated titles
        </label>
        <span className="text-[10px] text-muted-foreground/65">
          Key: {apiKeyConfigured ? "configured" : "not configured"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => saveSettings()}
          disabled={busy}
          className={HELP_PRIMARY_BUTTON_CLASS}
        >
          <LuCheck size={13} />
          {busy ? "Saving…" : "Save settings"}
        </button>
        <button
          type="button"
          onClick={clearKey}
          disabled={busy || !apiKeyConfigured}
          className={HELP_SECONDARY_BUTTON_CLASS}
        >
          Clear key
        </button>
      </div>

      {saved && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-400">
          <LuCheck className="mt-0.5 shrink-0" size={14} />
          <span>AI chat title settings saved.</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
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
      invalidateMiddlewareStartupBootstrap()
      emit("sidebar:refresh")
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
    <section className={HELP_SECTION_CLASS}>
      <div className="flex items-start gap-4">
        <span className={HELP_ICON_CLASS}>
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
          className={HELP_SECONDARY_BUTTON_CLASS}
        >
          <LuRefreshCw size={13} className={busy === "scan" ? "animate-spin" : ""} />
          {busy === "scan" ? "Scanning…" : copy.scanLabel}
        </button>
        <button
          type="button"
          onClick={importSessions}
          disabled={busy !== null || !scan || importable === 0}
          className={HELP_PRIMARY_BUTTON_CLASS}
        >
          {busy === "import" ? "Importing…" : copy.importLabel}
        </button>
      </div>

      {scan && (
        <div className="mt-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.045] p-3 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Sessions" value={scanSummary.total} />
            <Stat label="Direct" value={scanSummary.direct} />
            <Stat label={copy.channelLabel} value={scanSummary.groups} />
            <Stat label="Topics" value={scanSummary.topics} />
            <Stat label="Imported" value={scanSummary.alreadyImported} />
          </div>
          {scanGroups.length > 0 && (
            <div className="mt-3 space-y-1 pt-3">
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
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-400">
          <LuCheck className="mt-0.5 shrink-0" size={14} />
          <span>Imported {result.summary.imported}, skipped {result.summary.skipped}, failed {result.summary.failed}.</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
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
