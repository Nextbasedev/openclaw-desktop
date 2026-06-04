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
- Branch: v3

Setup:
1. Ensure Node.js 22+ and pnpm exist.
2. Start/verify OpenClaw Gateway:
   - openclaw gateway status
   - expected Middleware gateway URL: ws://127.0.0.1:18789
3. Clone/update the repo, checkout v3, install, and build:
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
- Branch: v3

Setup:
1. Ensure Node.js 22+ and pnpm exist.
2. Start/verify OpenClaw Gateway on this VPS:
   - openclaw gateway status
   - expected Middleware gateway URL: ws://127.0.0.1:18789
3. Clone/update the repo, checkout v3, install, and build:
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
6. Middleware URL rule: use the URL Desktop can actually reach — HTTPS reverse proxy first, then Tailscale MagicDNS/100.x.y.z, then private IP/LAN, then public IP:8787 only if firewall/security-group allows it.

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
Network note: <public domain | tailscale | private ip | public ip | reverse proxy>
Verified: desktop-smoke-test passed
Blocker: <none | exact blocker>`

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
    <div className="h-full min-h-0 w-full overflow-y-auto bg-transparent px-5 py-6 sm:px-8 sm:py-7">
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
              <div className="flex h-full w-full max-w-[640px] flex-col rounded-[26px] bg-white/[0.026] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] sm:p-6">
                <div className="flex items-center justify-between pb-5">
                  <p className="text-[15px] font-semibold tracking-tight text-zinc-100">OpenClaw</p>
                  {setupMode !== "choice" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSetupModeChange("choice")}
                      className="h-7 gap-1 rounded-lg px-2 text-xs font-normal text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100"
                    >
                      <span className="flex h-3 w-3 items-center justify-center">
                        <FaArrowLeft className="h-2.5 w-2.5" />
                      </span>
                      Back
                    </Button>
                  )}
                </div>

                <header className="flex items-start gap-4 pb-5 text-left">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.055] text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
                    <HugeiconsIcon icon={ServerStack01Icon} size={22} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[20px] font-semibold tracking-tight text-white">
                      Connect OpenClaw Middleware
                    </p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
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

                    {setupMode !== "choice" && setupMode !== "remote" && (
                      <details className="rounded-2xl bg-white/[0.025] p-4">
                        <summary className="cursor-pointer text-sm font-medium text-zinc-300 select-none hover:text-white">
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
                        "flex size-12 items-center justify-center rounded-2xl bg-white/[0.045] text-zinc-200",
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
                          <details className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <summary className="cursor-pointer text-sm font-medium text-zinc-300 select-none hover:text-white">
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
    <div className="space-y-4">
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
          "text-xs text-zinc-500",
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
    <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10 sm:h-1.5">
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
        "rounded-md border p-5 text-left transition-all",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
          : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-md",
            active
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-white/5 text-zinc-400"
          )}
        >
          <HugeiconsIcon icon={icon} size={18} />
        </div>
        <p className="text-sm font-medium text-zinc-100">{title}</p>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        {description}
      </p>
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
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <StepBadge step="2" label="Check local OpenClaw" />
      <div>
        <p className="text-sm font-medium text-zinc-100">
          We&apos;ll look for OpenClaw on this machine.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          If OpenClaw is running on this computer, Desktop connects locally. No
          pairing code or token needed.
        </p>
      </div>
      <StatusMessage
        message={detectMessage}
        fallback="Checking for local OpenClaw..."
      />
      <Button
        type="button"
        onClick={onDetect}
        disabled={checking}
        className="w-full"
      >
        {checking ? "Checking..." : "Start / detect local backend"}
      </Button>
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-medium text-zinc-300">Manual local URL</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Only use this if auto-detect cannot find the local Middleware. Leave
          pairing/token empty for local setup.
        </p>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <Label
              htmlFor="local-middleware-url"
              className="text-xs text-zinc-300"
            >
              Middleware URL
            </Label>
            <Input
              id="local-middleware-url"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:8787"
              disabled={busy}
              className="border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <Button
            onClick={onSave}
            disabled={busy || missingConfig}
            className="w-full"
            size="sm"
          >
            {saving ? "Connecting..." : "Connect local backend"}
          </Button>
        </div>
      </div>
      <PromptBox
        title="If OpenClaw is not running, ask your local OpenClaw:"
        prompt={LOCAL_OPENCLAW_PROMPT}
      />
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
    <div className="relative overflow-hidden rounded-[28px] bg-white/[0.032] p-5 shadow-[0_20px_56px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Remote connection</p>
          <p className="mt-1 max-w-[420px] text-[12px] leading-relaxed text-muted-foreground/64">
            Connect Desktop to middleware running on your server. Paste the verified URL and pairing code below.
          </p>
        </div>
        <SetupPromptButton prompt={VPS_OPENCLAW_PROMPT} />
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
        <p className="text-[11px] text-muted-foreground/45">
          Visible copy for server OpenClaw
        </p>
      </div>
      <pre className="max-h-[150px] overflow-y-auto rounded-[18px] bg-black/18 px-4 py-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-zinc-400/90 shadow-[inset_0_1px_16px_rgba(0,0,0,0.18)]">
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
      className="h-9 shrink-0 rounded-2xl border-0 bg-white/[0.055] px-3 text-[12px] text-zinc-300 hover:bg-white/[0.085] hover:text-white"
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
          className="h-12 rounded-[18px] border-0 bg-white/[0.06] px-4 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus-visible:bg-white/[0.085] focus-visible:ring-0"
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
            className="h-12 rounded-[18px] border-0 bg-white/[0.06] px-4 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus-visible:bg-white/[0.085] focus-visible:ring-0"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onShowTokenChange(!showToken)}
            disabled={disabled}
            className="size-12 rounded-[18px] border-0 bg-white/[0.06] text-zinc-300 hover:bg-white/[0.085]"
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
        "rounded-xl border px-3 py-2 text-xs leading-relaxed",
        message?.ok
          ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
          : "border-amber-500/20 bg-amber-500/5 text-amber-300"
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
    <div className="rounded-2xl bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-zinc-300">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyPrompt}
          className="h-7 rounded-lg border-0 bg-white/[0.055] px-2 text-[11px] text-zinc-300 hover:bg-white/[0.085] active:translate-y-0"
        >
          <HugeiconsIcon icon={Copy01Icon} size={13} />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre className="mt-3 h-[172px] overflow-y-auto rounded-xl bg-black/30 p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-400 shadow-[inset_0_1px_12px_rgba(0,0,0,0.18)]">
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
          className="h-11 rounded-2xl border-0 bg-white/[0.06] px-4 text-[13px] text-zinc-100 placeholder:text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] focus-visible:ring-0 focus-visible:bg-white/[0.085]"
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
            className="h-11 rounded-2xl border-0 bg-white/[0.06] px-4 text-[13px] text-zinc-100 placeholder:text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] focus-visible:ring-0 focus-visible:bg-white/[0.085]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onShowTokenChange(!showToken)}
            disabled={disabled}
            className="h-11 rounded-2xl border-0 bg-white/[0.06] text-zinc-300 hover:bg-white/[0.085]"
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
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-emerald-100">
              Workspace ready
            </p>
            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-300/80">
              Connected
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-emerald-100/62">
            Projects, terminal, git, chats, files, streams, and approvals will run through this runtime.
          </p>
          <div className="mt-4 rounded-xl bg-black/10 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-100/38">
              Middleware URL
            </p>
            <p className="mt-1 truncate font-mono text-[12px] text-emerald-50/80" title={displayUrl}>
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
        className="mt-5 w-full border-0 bg-emerald-400/[0.08] text-emerald-100 hover:bg-emerald-400/[0.13]"
      >
        <HugeiconsIcon icon={Unlink03Icon} size={14} />
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>
    </div>
  )
}

function ConnectStatusSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <div className="mx-auto flex size-11 animate-pulse items-center justify-center rounded-2xl bg-white/8" />
      <div className="mt-3 flex flex-col items-center gap-2">
        <div className="h-4 w-32 animate-pulse rounded-md bg-white/10" />
        <div className="h-3 w-72 max-w-full animate-pulse rounded-md bg-white/6" />
        <div className="h-3 w-56 max-w-full animate-pulse rounded-md bg-white/5" />
      </div>
      <div className="mx-auto mt-4 h-8 w-28 animate-pulse rounded-md bg-white/8" />
    </div>
  )
}

function ConnectPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="size-12 animate-pulse rounded-md border border-white/10 bg-white/6" />
        <div className="space-y-2">
          <div className="mx-auto h-6 w-64 animate-pulse rounded-md bg-white/10" />
          <div className="mx-auto h-4 w-80 max-w-full animate-pulse rounded-md bg-white/6" />
          <div className="mx-auto h-4 w-72 max-w-full animate-pulse rounded-md bg-white/5" />
        </div>
      </div>

      <ConnectStatusSkeleton />
    </div>
  )
}
