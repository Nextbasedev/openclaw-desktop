"use client"

import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { FaArrowLeft } from "react-icons/fa"
import {
  CheckmarkCircle02Icon,
  ComputerIcon,
  Copy01Icon,
  EyeIcon,
  Globe02Icon,
  ServerStack01Icon,
  Unlink03Icon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import ConnectionErrorGuide from "@/components/connect/ConnectionErrorGuide"

type ConnectionStatus = {
  gatewayConfigured: boolean
  gatewayUrl?: string | null
  gatewayToken?: string | null
  hasConnection: boolean
  status: string
}

type ConnectResult = {
  ok: boolean
  url?: string
  message?: string
  error?: string
  errorTitle?: string
  isLocal?: boolean
  isTailscale?: boolean
  addedOrigins?: string[]
  fix?: {
    description: string
    origins: string[]
    example: Record<string, unknown>
  }
}

type DetectMessage = { ok: boolean; text: string }

type ConnectPageViewProps = {
  url: string
  token: string
  showToken: boolean
  setupMode: "choice" | "local" | "remote"
  status: ConnectionStatus | null
  connectResult: ConnectResult | null
  error: string | null
  testing: boolean
  saving: boolean
  disconnecting: boolean
  loadingStatus: boolean
  isConnected: boolean
  autoDetect: boolean
  detecting: boolean
  detectMessage: DetectMessage | null
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSetupModeChange: (mode: "choice" | "local" | "remote") => void
  onAutoDetectChange: (enabled: boolean) => void
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}

const LOCAL_OPENCLAW_PROMPT = `Set up OpenClaw Desktop Middleware for LOCAL mode.

Context:
- OpenClaw Desktop and Middleware are on this same computer.
- Desktop needs full OpenClaw access through Middleware: chats, sessions, cron, projects, workspace files, git, terminal, streams, usage, settings, and approvals.
- Do not stop after only starting the server. Run the smoke test below and fix failures.

Source:
- Repo: https://github.com/Nextbasedev/openclaw-desktop.git
- Branch: master

Setup:
1. Ensure Node.js 22+ and pnpm exist.
2. Start/verify OpenClaw Gateway:
   - openclaw gateway status
   - expected Middleware gateway URL: ws://127.0.0.1:18789
3. Clone/update the repo, checkout master, install, and build:
   - pnpm install --frozen-lockfile
   - pnpm --filter @openclaw/desktop-middleware build
4. Run apps/middleware on port 8787:
   - HOST=127.0.0.1
   - PORT=8787
   - NODE_ENV=production
   - OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   - WORKSPACE_ROOT=$HOME/.openclaw/workspace
   - MIDDLEWARE_TOKEN=<stable random secret>
   - MIDDLEWARE_PAIRING_CODE=<short readable code, 6-8 uppercase chars>
5. Foreground run is okay for a local test; service is optional.
6. Middleware URL rule: use http://127.0.0.1:8787 unless you changed the port.

Mandatory verification:
Run the repo smoke-test script. It checks health, pairing/token, auth APIs, admin commands, cron, stream, chat send, workspace, and terminal.

Command:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_PAIRING_CODE=<pairing-code> docs/installation/desktop-middleware-smoke-test.sh

If you already know the token, use:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_TOKEN=<token> docs/installation/desktop-middleware-smoke-test.sh

If the script fails because no model/API key is configured, say Middleware is working but chat model/provider is the blocker. For any other failure, fix it and rerun the script. Do not give the URL/code until the script prints DESKTOP_MIDDLEWARE_SMOKE_TEST_OK or you have one exact blocker.

When finished, reply only:
Middleware URL: <reachable-url>
Pairing code: <code>
Network note: local loopback
Verified: desktop-smoke-test passed
Blocker: <none | exact blocker>`

const VPS_OPENCLAW_PROMPT = `Set up OpenClaw Desktop Middleware for REMOTE/VPS mode.

Context:
- OpenClaw Desktop will connect to Middleware running on this VPS/server.
- Desktop needs full OpenClaw access through Middleware: chats, sessions, cron, projects, workspace files, git, terminal, streams, usage, settings, and approvals.
- Do not stop after only starting the server. Run the smoke test below and fix failures.

Source:
- Repo: https://github.com/Nextbasedev/openclaw-desktop.git
- Branch: master

Setup:
1. Ensure Node.js 22+ and pnpm exist.
2. Start/verify OpenClaw Gateway on this VPS:
   - openclaw gateway status
   - expected Middleware gateway URL: ws://127.0.0.1:18789
3. Clone/update the repo, checkout master, install, and build:
   - pnpm install --frozen-lockfile
   - pnpm --filter @openclaw/desktop-middleware build
4. Run apps/middleware on port 8787:
   - HOST=0.0.0.0
   - PORT=8787
   - NODE_ENV=production
   - OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   - WORKSPACE_ROOT=$HOME/.openclaw/workspace
   - MIDDLEWARE_TOKEN=<stable random secret>
   - MIDDLEWARE_PAIRING_CODE=<short readable code, 6-8 uppercase chars>
5. Run it as an auto-restarting service that survives crashes and reboot.
6. Choose a network path only after verifying the final URL:
   - Prefer an HTTPS reverse proxy. Private IP/LAN or a public IP:8787 is acceptable only when its firewall/security-group permits Desktop access.
   - Use a Tailscale MagicDNS name or 100.x.y.z address only when Tailscale is configured on the VPS. Run \`tailscale status\`, obtain the actual hostname/IP, then request \`<middleware-url>/health\` from this runtime and require a successful response. Never invent or guess a Tailscale URL.
   - If Tailscale is not configured and there is no other verified network path, do not return a Middleware URL or pairing code. Report the blocker and these next steps: (1) install and log in to Tailscale on this VPS, (2) install and log in to Tailscale on the Desktop device using the same account/tailnet, (3) confirm both devices appear in \`tailscale status\`, then retry setup.

Mandatory verification:
1. Run the repo smoke-test script using the final URL. It checks health, pairing/token, auth APIs, admin commands, cron, stream, chat send, workspace, and terminal.
2. Before the final response, independently request \`<middleware-url>/health\` from this runtime and confirm it returns a healthy Middleware response. Do not return a URL that fails this check.
3. If you have access to the Desktop device, verify the same URL there too. If you do not, do not call the URL broken or withhold valid credentials solely for that reason: return the server-verified URL, state that the Desktop check is still required, and give the exact \`<middleware-url>/health\` check for the user to run.

Command:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_PAIRING_CODE=<pairing-code> docs/installation/desktop-middleware-smoke-test.sh

If you already know the token, use:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_TOKEN=<token> docs/installation/desktop-middleware-smoke-test.sh

If the script fails because no model/API key is configured, say Middleware is working but chat model/provider is the blocker. For any other failure, fix it and rerun the script. Do not give the URL/code until the script prints DESKTOP_MIDDLEWARE_SMOKE_TEST_OK or you have one exact blocker.

When finished, reply only:
- If verified from this runtime:
  Middleware URL: <reachable-url>
  Pairing code: <code>
  Network note: <public domain | tailscale | private ip | public ip | reverse proxy>
  Verified: final URL health check and desktop-smoke-test passed
  Desktop check: <passed | required — open <middleware-url>/health from the Desktop device>
  Blocker: none
- If blocked:
  Middleware URL: not available
  Pairing code: not available
  Network note: <tailscale not configured | exact network blocker>
  Next steps: <specific configuration steps>
  Verified: not run
  Blocker: <exact blocker>`

export function ConnectPageView({
  url,
  token,
  showToken,
  setupMode,
  status,
  connectResult,
  error,
  testing,
  saving,
  disconnecting,
  loadingStatus,
  isConnected,
  detecting,
  detectMessage,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onSetupModeChange,
  onAutoDetectChange,
  onTest,
  onSave,
  onDisconnect,
}: ConnectPageViewProps) {
  const busy = testing || saving || disconnecting || detecting
  const missingConfig =
    setupMode === "local" ? !url.trim() : !url.trim() || !token.trim()
  const showSplitShell = !loadingStatus && !isConnected
  const errorBlockRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isConnected || (!error && !connectResult)) return
    errorBlockRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    })
  }, [connectResult, error, isConnected])

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto bg-transparent px-2 py-6 sm:px-8 sm:py-7">
      <div
        className={cn(
          "mx-auto flex min-h-full w-full justify-center",
          isConnected ? "items-start" : "items-center",
          "max-w-[760px]"
        )}
      >
        <div
          className={cn(
            "grid w-full items-center justify-center gap-10"
          )}
        >
          <div
            className={cn(
              "w-full overflow-hidden rounded-md p-0",
              showSplitShell
                ? "flex h-[min(820px,calc(100vh-120px))] items-center justify-center"
                : ""
            )}
          >
            {showSplitShell ? (
              <div className="flex h-full w-full max-w-[640px] flex-col rounded-[26px] bg-black/[0.018] dark:bg-white/[0.026] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] sm:p-6">
                <div className="flex items-center justify-between pb-5">
                  <p className="text-[15px] font-semibold tracking-tight text-foreground dark:text-zinc-100">OpenClaw</p>
                  {setupMode !== "choice" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSetupModeChange("choice")}
                      className="h-7 gap-1 rounded-lg px-2 text-xs font-normal text-muted-foreground transition-colors hover:bg-black/[0.035] hover:text-foreground dark:text-zinc-400 dark:hover:bg-white/[0.045] dark:hover:text-zinc-100"
                    >
                      <span className="flex h-3 w-3 items-center justify-center">
                        <FaArrowLeft className="h-2.5 w-2.5" />
                      </span>
                      Back
                    </Button>
                  )}
                </div>

                <header className="flex items-start gap-4 pb-5 text-left">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-black/[0.045] dark:bg-white/[0.055] text-muted-foreground dark:text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
                    <HugeiconsIcon icon={ServerStack01Icon} size={22} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[20px] font-semibold tracking-tight text-foreground dark:text-white">
                      Connect OpenClaw Middleware
                    </p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground/70 dark:text-zinc-500">
                      Ask OpenClaw to prepare the Middleware, then paste the URL
                      and pairing code here.
                    </p>
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="space-y-4">
                    {setupMode === "choice" ? (
                      <ChoiceScreen onSelect={onSetupModeChange} alignLeft />
                    ) : setupMode === "local" ? (
                      <LocalOpenClawPanel
                        url={url}
                        busy={busy}
                        saving={saving}
                        missingConfig={missingConfig}
                        loadingStatus={loadingStatus}
                        detectMessage={detectMessage}
                        onDetect={() => onAutoDetectChange(true)}
                        onUrlChange={onUrlChange}
                        onSave={onSave}
                      />
                    ) : (
                      <VpsOpenClawPanel
                        url={url}
                        token={token}
                        showToken={showToken}
                        busy={busy}
                        saving={saving}
                        missingConfig={missingConfig}
                        onUrlChange={onUrlChange}
                        onTokenChange={onTokenChange}
                        onShowTokenChange={onShowTokenChange}
                        onSave={onSave}
                      />
                    )}

                    {(error || connectResult) && (
                      <div ref={errorBlockRef}>
                        <ConnectionErrorGuide
                          result={connectResult}
                          rawError={error}
                          gatewayUrl={url}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <ConnectProgressRail
                  setupMode={setupMode}
                  url={url}
                  token={token}
                  detectMessage={detectMessage}
                  connectResult={connectResult}
                />
              </div>
            ) : (
              <div className={cn("mx-auto w-full max-w-[560px]", isConnected ? "space-y-5" : "space-y-6")}>
                {loadingStatus ? (
                  <ConnectPageSkeleton />
                ) : (
                  <>
                    <header className={cn("space-y-3", isConnected ? "text-left" : "text-center")}>
                      <div className={cn(
                        "flex size-12 items-center justify-center rounded-2xl bg-black/[0.035] dark:bg-white/[0.045] text-muted-foreground dark:text-zinc-200",
                        isConnected ? "" : "mx-auto"
                      )}>
                        <HugeiconsIcon
                          icon={ServerStack01Icon}
                          size={22}
                        />
                      </div>
                      <div>
                        <p className="text-xl font-semibold tracking-tight text-foreground">
                          {isConnected ? "Workspace connection" : "Where is OpenClaw running?"}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground/65">
                          {isConnected
                            ? "OpenClaw Desktop is connected and ready to use this workspace runtime."
                            : "Choose where OpenClaw runs. Desktop must be able to reach that machine over your network."}
                        </p>
                      </div>
                    </header>

                    {isConnected ? (
                  <ConnectedState
                    url={connectResult?.url || status?.gatewayUrl || url}
                    busy={busy}
                    disconnecting={disconnecting}
                    onDisconnect={onDisconnect}
                  />
                    ) : (
                      <>
                        {setupMode === "choice" ? (
                          <ChoiceScreen onSelect={onSetupModeChange} />
                        ) : setupMode === "local" ? (
                          <LocalOpenClawPanel
                            url={url}
                            busy={busy}
                            saving={saving}
                            missingConfig={missingConfig}
                            loadingStatus={loadingStatus}
                            detectMessage={detectMessage}
                            onDetect={() => onAutoDetectChange(true)}
                            onUrlChange={onUrlChange}
                            onSave={onSave}
                          />
                        ) : (
                          <VpsOpenClawPanel
                            url={url}
                            token={token}
                            showToken={showToken}
                            busy={busy}
                            saving={saving}
                            missingConfig={missingConfig}
                            onUrlChange={onUrlChange}
                            onTokenChange={onTokenChange}
                            onShowTokenChange={onShowTokenChange}
                            onSave={onSave}
                          />
                        )}

                        {setupMode !== "choice" && (
                          <details className="rounded-xl border border-black/[0.08] dark:border-white/10 bg-black/[0.035] dark:bg-black/20 p-4">
                            <summary className="cursor-pointer text-sm font-medium text-muted-foreground dark:text-zinc-300 select-none hover:text-foreground dark:hover:text-white">
                              Advanced manual setup
                            </summary>
                            <div className="mt-4 space-y-4">
                              <ManualFields
                                url={url}
                                token={token}
                                showToken={showToken}
                                disabled={busy}
                                onUrlChange={onUrlChange}
                                onTokenChange={onTokenChange}
                                onShowTokenChange={onShowTokenChange}
                              />
                              <div className="grid grid-cols-2 gap-3">
                                <Button
                                  onClick={onTest}
                                  disabled={busy || missingConfig}
                                  variant="outline"
                                  size="sm"
                                >
                                  {testing ? "Testing..." : "Test"}
                                </Button>
                                <Button
                                  onClick={onSave}
                                  disabled={busy || missingConfig}
                                  size="sm"
                                >
                                  {saving ? "Connecting..." : "Save"}
                                </Button>
                              </div>
                            </div>
                          </details>
                        )}
                      </>
                    )}

                    {!isConnected && (error || connectResult) && (
                      <div ref={errorBlockRef}>
                        <ConnectionErrorGuide
                          result={connectResult}
                          rawError={error}
                          gatewayUrl={url}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

function ChoiceScreen({
  onSelect,
  alignLeft = false,
}: {
  onSelect: (mode: "local" | "remote") => void
  alignLeft?: boolean
}) {
  return (
    <div className="rounded-[28px] bg-black/[0.02] dark:bg-white/[0.032] p-4 shadow-[0_20px_56px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[0_20px_56px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={false}
          icon={ComputerIcon}
          title="OpenClaw is on this computer"
          description="Choose this if OpenClaw runs locally on this machine."
          onClick={() => onSelect("local")}
        />
        <ModeCard
          active={false}
          icon={Globe02Icon}
          title="OpenClaw is on a VPS"
          description="Choose this if OpenClaw runs on a server or cloud machine."
          onClick={() => onSelect("remote")}
        />
      </div>
      <p
        className={cn(
          "mt-4 text-[12px] text-muted-foreground/70 dark:text-zinc-500",
          alignLeft ? "text-left" : "text-center"
        )}
      >
        Pick one. The next screen will guide that setup.
      </p>
    </div>
  )
}

function ConnectProgressRail({
  setupMode,
  url,
  token,
  detectMessage,
  connectResult,
}: {
  setupMode: "choice" | "local" | "remote"
  url: string
  token: string
  detectMessage: DetectMessage | null
  connectResult: ConnectResult | null
}) {
  const firstStepProgress = setupMode === "choice" ? 0 : 100

  let secondStepProgress = 0
  if (setupMode === "local") {
    secondStepProgress = url.trim() ? 70 : 0
    if (detectMessage?.ok || connectResult?.ok) secondStepProgress = 100
  } else if (setupMode === "remote") {
    secondStepProgress += url.trim() ? 50 : 0
    secondStepProgress += token.trim() ? 50 : 0
    if (connectResult?.ok) secondStepProgress = 100
  }

  return (
    <div className="flex w-full items-center justify-start gap-2 pt-4 sm:gap-3">
      <ProgressSegment progress={firstStepProgress} />
      <ProgressSegment progress={secondStepProgress} />
    </div>
  )
}

function ProgressSegment({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress))

  return (
    <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10 sm:h-1.5">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </span>
  )
}

function ModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean
  icon: typeof ComputerIcon
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[22px] p-4 text-left transition-all",
        active
          ? "bg-emerald-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "bg-black/[0.025] hover:bg-black/[0.045] dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-2xl",
            active
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-black/[0.045] dark:bg-white/[0.055] text-muted-foreground dark:text-zinc-400"
          )}
        >
          <HugeiconsIcon icon={icon} size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground dark:text-zinc-100">{title}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground/70 dark:text-zinc-500">
            {description}
          </p>
        </div>
      </div>
    </button>
  )
}

function LocalOpenClawPanel({
  url,
  busy,
  saving,
  missingConfig,
  loadingStatus,
  detectMessage,
  onDetect,
  onUrlChange,
  onSave,
}: {
  url: string
  busy: boolean
  saving: boolean
  missingConfig: boolean
  loadingStatus: boolean
  detectMessage: DetectMessage | null
  onDetect: () => void
  onUrlChange: (value: string) => void
  onSave: () => void
}) {
  const checking = busy || loadingStatus

  return (
    <div className="rounded-[28px] bg-black/[0.02] dark:bg-white/[0.032] p-5 shadow-[0_20px_56px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[0_20px_56px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Local connection</p>
          <p className="mt-1 max-w-[420px] text-[12px] leading-relaxed text-muted-foreground/64">
            Detect middleware running on this computer. No pairing code is needed for local setup.
          </p>
        </div>
        <span className="rounded-2xl bg-black/[0.045] dark:bg-white/[0.055] px-3 py-2 text-[12px] text-muted-foreground dark:text-zinc-300">
          Local
        </span>
      </div>

      <div className="mt-5 space-y-4">
      <StatusMessage
        message={detectMessage}
        fallback="Checking for local OpenClaw..."
      />
      <Button
        type="button"
        onClick={onDetect}
        disabled={checking}
        className="h-12 w-full rounded-[20px] bg-foreground text-[13px] font-semibold text-background shadow-[0_16px_44px_rgba(255,255,255,0.10)] hover:bg-foreground/90 disabled:opacity-50"
      >
        {checking ? "Checking..." : "Start / detect local backend"}
      </Button>

      <div className="space-y-2">
        <Label className="block px-1 text-[11px] font-medium text-muted-foreground/76">
          Manual local URL
        </Label>
        <Input
          id="local-middleware-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="http://127.0.0.1:8787"
          disabled={busy}
          className="h-12 rounded-[18px] border-0 bg-black/[0.045] dark:bg-white/[0.06] px-4 text-[13px] text-foreground dark:text-zinc-100 placeholder:text-muted-foreground/45 dark:placeholder:text-zinc-500 focus-visible:bg-black/[0.065] dark:focus-visible:bg-white/[0.085] focus-visible:ring-0"
        />
      </div>

      <Button
        onClick={onSave}
        disabled={busy || missingConfig}
        className="h-11 w-full rounded-[18px] bg-black/[0.045] dark:bg-white/[0.06] text-[13px] font-medium text-foreground dark:text-zinc-100 hover:bg-black/[0.065] dark:hover:bg-white/[0.085] disabled:opacity-50"
      >
        {saving ? "Connecting..." : "Connect local backend"}
      </Button>

      <SetupPromptPreview prompt={LOCAL_OPENCLAW_PROMPT} />
      </div>
    </div>
  )
}

function VpsOpenClawPanel(props: {
  url: string
  token: string
  showToken: boolean
  busy: boolean
  saving: boolean
  missingConfig: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSave: () => void
}) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-black/[0.02] dark:bg-white/[0.032] p-5 shadow-[0_20px_56px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[0_20px_56px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Remote connection</p>
          <p className="mt-1 max-w-[420px] text-[12px] leading-relaxed text-muted-foreground/64">
            Connect Desktop to middleware running on your server. Paste the verified URL and pairing code below.
          </p>
        </div>
      </div>

      <div className="relative mt-5 space-y-4">
        <RemoteCredentialFields
          url={props.url}
          token={props.token}
          showToken={props.showToken}
          disabled={props.busy}
          onUrlChange={props.onUrlChange}
          onTokenChange={props.onTokenChange}
          onShowTokenChange={props.onShowTokenChange}
        />
        <SetupPromptPreview prompt={VPS_OPENCLAW_PROMPT} />
      </div>

      <Button
        onClick={props.onSave}
        disabled={props.busy || props.missingConfig}
        className="relative mt-5 h-12 w-full rounded-[20px] bg-foreground text-[13px] font-semibold text-background shadow-[0_16px_44px_rgba(255,255,255,0.10)] hover:bg-foreground/90 disabled:opacity-50"
      >
        {props.saving ? "Pairing..." : "Pair and continue"}
      </Button>
    </div>
  )
}

function SetupPromptPreview({ prompt }: { prompt: string }) {
  return (
    <div className="pt-1">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/54">
          Setup prompt
        </p>
        <SetupPromptButton prompt={prompt} />
      </div>
      <pre className="max-h-[150px] overflow-y-auto rounded-[18px] bg-black/[0.04] dark:bg-black/20 px-4 py-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground dark:text-zinc-400/90 shadow-[inset_0_1px_16px_rgba(0,0,0,0.18)]">
        {prompt}
      </pre>
    </div>
  )
}

function SetupPromptButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copyPrompt}
      className="h-9 shrink-0 rounded-2xl border-0 bg-black/[0.045] dark:bg-white/[0.055] px-3 text-[12px] text-muted-foreground dark:text-zinc-300 hover:bg-black/[0.065] dark:hover:bg-white/[0.085] hover:text-foreground dark:hover:text-white"
    >
      <HugeiconsIcon icon={Copy01Icon} size={14} />
      {copied ? "Copied" : "Copy setup"}
    </Button>
  )
}

function RemoteCredentialFields({
  url,
  token,
  showToken,
  disabled,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
}: {
  url: string
  token: string
  showToken: boolean
  disabled: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="block px-1 text-[11px] font-medium text-muted-foreground/76">
          Middleware URL
        </Label>
        <Input
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://domain.com or http://100.x.y.z:8787"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="h-12 rounded-[18px] border-0 bg-black/[0.045] dark:bg-white/[0.06] px-4 text-[13px] text-foreground dark:text-zinc-100 placeholder:text-muted-foreground/45 dark:placeholder:text-zinc-500 focus-visible:bg-black/[0.065] dark:focus-visible:bg-white/[0.085] focus-visible:ring-0"
        />
      </div>
      <div className="space-y-2">
        <Label className="block px-1 text-[11px] font-medium text-muted-foreground/76">
          Pairing code
        </Label>
        <div className="flex gap-2">
          <Input
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            type={showToken ? "text" : "password"}
            placeholder="ABC-123"
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-[18px] border-0 bg-black/[0.045] dark:bg-white/[0.06] px-4 text-[13px] text-foreground dark:text-zinc-100 placeholder:text-muted-foreground/45 dark:placeholder:text-zinc-500 focus-visible:bg-black/[0.065] dark:focus-visible:bg-white/[0.085] focus-visible:ring-0"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onShowTokenChange(!showToken)}
            disabled={disabled}
            className="size-12 rounded-[18px] border-0 bg-black/[0.045] dark:bg-white/[0.06] text-muted-foreground dark:text-zinc-300 hover:bg-black/[0.065] dark:hover:bg-white/[0.085]"
          >
            <HugeiconsIcon icon={showToken ? ViewOffIcon : EyeIcon} size={16} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function StepBadge({ step, label }: { step: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
      <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.16)]">
        {step}
      </span>
      {label}
    </div>
  )
}

function StatusMessage({
  message,
  fallback,
}: {
  message: DetectMessage | null
  fallback: string
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] px-3.5 py-3 text-xs leading-relaxed",
        message?.ok
          ? "bg-emerald-500/10 text-emerald-300"
          : "bg-amber-500/10 text-amber-300"
      )}
    >
      {message?.text || fallback}
    </div>
  )
}

function PromptBox({ title, prompt }: { title: string; prompt: string }) {
  const [copied, setCopied] = useState(false)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="rounded-2xl bg-black/[0.035] dark:bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-muted-foreground dark:text-zinc-300">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyPrompt}
          className="h-7 rounded-lg border-0 bg-black/[0.045] dark:bg-white/[0.055] px-2 text-[11px] text-muted-foreground dark:text-zinc-300 hover:bg-black/[0.065] dark:hover:bg-white/[0.085] active:translate-y-0"
        >
          <HugeiconsIcon icon={Copy01Icon} size={13} />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="mt-3 h-[172px] overflow-y-auto rounded-xl bg-black/[0.05] dark:bg-black/30 p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground dark:text-zinc-400 shadow-[inset_0_1px_12px_rgba(0,0,0,0.18)]">
        {prompt}
      </pre>
    </div>
  )
}

function ManualFields({
  url,
  token,
  showToken,
  disabled,
  tokenLabel = "Access token",
  tokenPlaceholder = "Paste token",
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
}: {
  url: string
  token: string
  showToken: boolean
  disabled: boolean
  tokenLabel?: string
  tokenPlaceholder?: string
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
}) {
  return (
    <div className="space-y-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="middleware-url" className="text-[11px] font-medium text-muted-foreground/80">
          Middleware URL
        </Label>
        <Input
          id="middleware-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://domain.com or http://100.x.y.z:8787"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="h-11 rounded-2xl border-0 bg-black/[0.045] dark:bg-white/[0.06] px-4 text-[13px] text-foreground dark:text-zinc-100 placeholder:text-muted-foreground/45 dark:placeholder:text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] focus-visible:ring-0 focus-visible:bg-black/[0.065] dark:focus-visible:bg-white/[0.085]"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="middleware-token" className="text-[11px] font-medium text-muted-foreground/80">
          {tokenLabel}
        </Label>
        <div className="flex gap-2">
          <Input
            id="middleware-token"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            type={showToken ? "text" : "password"}
            placeholder={tokenPlaceholder}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-2xl border-0 bg-black/[0.045] dark:bg-white/[0.06] px-4 text-[13px] text-foreground dark:text-zinc-100 placeholder:text-muted-foreground/45 dark:placeholder:text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.70)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] focus-visible:ring-0 focus-visible:bg-black/[0.065] dark:focus-visible:bg-white/[0.085]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onShowTokenChange(!showToken)}
            disabled={disabled}
            className="h-11 rounded-2xl border-0 bg-black/[0.045] dark:bg-white/[0.06] text-muted-foreground dark:text-zinc-300 hover:bg-black/[0.065] dark:hover:bg-white/[0.085]"
          >
            <HugeiconsIcon icon={showToken ? ViewOffIcon : EyeIcon} size={15} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConnectedState({
  url,
  busy,
  disconnecting,
  onDisconnect,
}: {
  url?: string | null
  busy: boolean
  disconnecting: boolean
  onDisconnect: () => void
}) {
  const displayUrl = url || "Middleware"

  return (
    <div className="rounded-2xl bg-emerald-500/[0.055] p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
              Workspace ready
            </p>
            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300/80">
              Connected
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-emerald-900/70 dark:text-emerald-100/62">
            Projects, terminal, git, chats, files, streams, and approvals will run through this runtime.
          </p>
          <div className="mt-4 rounded-xl bg-black/[0.07] dark:bg-black/10 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-900/55 dark:text-emerald-100/38">
              Middleware URL
            </p>
            <p className="mt-1 truncate font-mono text-[12px] text-emerald-950/85 dark:text-emerald-50/80" title={displayUrl}>
              {displayUrl}
            </p>
          </div>
        </div>
      </div>
      <Button
        onClick={onDisconnect}
        disabled={busy}
        variant="outline"
        size="sm"
        className="mt-5 w-full border-0 bg-emerald-400/[0.08] text-emerald-800 hover:bg-emerald-400/[0.13] dark:text-emerald-100"
      >
        <HugeiconsIcon icon={Unlink03Icon} size={14} />
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>
    </div>
  )
}

function ConnectStatusSkeleton() {
  return (
    <div className="rounded-2xl bg-emerald-500/[0.055] p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 animate-pulse items-center justify-center rounded-2xl bg-emerald-500/10" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-4 w-32 animate-pulse rounded-md bg-emerald-100/14" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-emerald-400/10" />
          </div>
          <div className="mt-2 space-y-2">
            <div className="h-3 w-full max-w-[360px] animate-pulse rounded-md bg-emerald-100/10" />
            <div className="h-3 w-4/5 animate-pulse rounded-md bg-emerald-100/[0.075]" />
          </div>
          <div className="mt-4 rounded-xl bg-black/10 px-3 py-2">
            <div className="h-2.5 w-24 animate-pulse rounded bg-emerald-100/[0.08]" />
            <div className="mt-2 h-3 w-56 max-w-full animate-pulse rounded-md bg-emerald-50/12" />
          </div>
        </div>
      </div>
      <div className="mt-5 h-9 w-full animate-pulse rounded-md bg-emerald-400/[0.08]" />
    </div>
  )
}

function ConnectPageSkeleton() {
  return (
    <div className="space-y-5">
      <header className="space-y-3 text-left">
        <div className="size-12 animate-pulse rounded-2xl bg-black/[0.035] dark:bg-white/[0.045]" />
        <div className="space-y-2">
          <div className="h-6 w-56 animate-pulse rounded-md bg-black/10 dark:bg-white/10" />
          <div className="h-4 w-full max-w-[460px] animate-pulse rounded-md bg-black/[0.045] dark:bg-white/6" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-black/[0.035] dark:bg-white/5" />
        </div>
      </header>

      <ConnectStatusSkeleton />
    </div>
  )
}
