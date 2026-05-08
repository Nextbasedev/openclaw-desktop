"use client"

import { HugeiconsIcon } from "@hugeicons/react"
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
import { GLASS_POPOVER } from "@/constants/glassPopover"
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
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSetupModeChange: (mode: "local" | "remote") => void
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}

const LOCAL_OPENCLAW_CONNECT_PROMPT = `Set up OpenClaw Desktop Middleware on this computer and give me the connection details.

Use this repo/branch:
https://github.com/Nextbasedev/openclaw-desktop.git
branch: main

Do this inside OpenClaw, not by asking the user to debug pairing manually:
1. Install or update OpenClaw Desktop Middleware from the repo above.
2. Make sure OpenClaw Gateway is running on this same computer.
3. Start Middleware on http://127.0.0.1:8787.
4. Middleware should connect to Gateway with desktop scopes: operator.read, operator.write, operator.approvals, and operator.admin.
5. Test http://127.0.0.1:8787/health and confirm openclaw.connected is true.
6. Do not ask the user to run openclaw devices approve. If pairing/auth fails, fix the middleware setup/update path.

When finished, give me only:
Middleware URL: http://127.0.0.1:8787
Pairing code: not needed locally`

const VPS_OPENCLAW_CONNECT_PROMPT = `Set up OpenClaw Desktop Middleware on this VPS and give me the connection details.

Use this repo/branch:
https://github.com/Nextbasedev/openclaw-desktop.git
branch: main

Do this inside OpenClaw, not by asking the user to debug pairing manually:
1. Install or update OpenClaw Desktop Middleware from the repo above. If Middleware already exists, use its Update Middleware/API flow; do not hand-edit random files.
2. Make sure OpenClaw Gateway is running on this VPS.
3. Start Middleware on port 8787 and expose the reachable VPS/domain/Tailscale URL.
4. Middleware should connect to Gateway with desktop scopes: operator.read, operator.write, operator.approvals, and operator.admin.
5. Test /health from the reachable URL and confirm openclaw.connected is true.
6. Return the Middleware URL and the Middleware pairing code from /etc/openclaw-middleware.env or the service configuration.
7. Do not ask the user to run openclaw devices approve. If pairing/auth fails, fix the middleware setup/update path without weakening remote/VPS pairing security.

When finished, give me only:
Middleware URL: <reachable-url>
Pairing code: <code>`

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
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onSetupModeChange,
  onTest,
  onSave,
  onDisconnect,
}: ConnectPageViewProps) {
  const busy = testing || saving || disconnecting || loadingStatus
  const missingConfig = setupMode === "local" ? !url.trim() : !url.trim() || !token.trim()

  return (
    <div className="min-h-0 h-full w-full overflow-y-auto bg-background px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center gap-4">
        <div className={cn("overflow-hidden p-6 sm:p-8", GLASS_POPOVER)}>
          <div className="mx-auto max-w-[560px] space-y-6">
            <header className="space-y-3 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-white/10 bg-white/5">
                <HugeiconsIcon icon={ServerStack01Icon} size={22} className="text-zinc-200" />
              </div>
              <div>
                <p className="text-xl font-semibold tracking-tight text-white">Connect OpenClaw Middleware</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  Ask OpenClaw to prepare the Middleware, then paste the URL and pairing code here.
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
            ) : setupMode === "choice" ? (
              <ChoiceScreen onSelect={onSetupModeChange} />
            ) : (
              <div className="space-y-4">
                <PromptBox
                  title={setupMode === "local" ? "Ask OpenClaw on this computer:" : "Ask OpenClaw on your VPS:"}
                  prompt={setupMode === "local" ? LOCAL_OPENCLAW_CONNECT_PROMPT : VPS_OPENCLAW_CONNECT_PROMPT}
                />

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-4 space-y-1">
                    <p className="text-sm font-medium text-zinc-100">Paste connection details</p>
                    <p className="text-xs leading-relaxed text-zinc-500">
                      {setupMode === "local"
                        ? "Local setup exchanges the middleware token automatically from this computer. No pairing code needed."
                        : "Pairing keeps the token exchange explicit and secure for VPS/server setups."}
                    </p>
                  </div>
                  <ManualFields
                    url={url}
                    token={token}
                    setupMode={setupMode}
                    showToken={showToken}
                    disabled={busy}
                    onUrlChange={onUrlChange}
                    onTokenChange={onTokenChange}
                    onShowTokenChange={onShowTokenChange}
                  />
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Button onClick={onTest} disabled={busy || missingConfig} variant="outline" size="sm">
                      {testing ? "Testing..." : "Test"}
                    </Button>
                    <Button onClick={onSave} disabled={busy || missingConfig} size="sm">
                      {saving ? "Pairing..." : "Pair and continue"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!isConnected && (error || connectResult) && (
          <ConnectionErrorGuide result={connectResult} rawError={error} gatewayUrl={url} />
        )}
      </div>
    </div>
  )
}

function ChoiceScreen({
  onSelect,
}: {
  onSelect: (mode: "local" | "remote") => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          icon={ComputerIcon}
          title="OpenClaw is on this computer"
          description="Copy the local setup prompt. OpenClaw will start Middleware locally; no pairing code is needed."
          onClick={() => onSelect("local")}
        />
        <ModeCard
          icon={Globe02Icon}
          title="OpenClaw is on a VPS"
          description="Copy the VPS setup prompt. OpenClaw will update/start Middleware and return the reachable URL plus pairing code."
          onClick={() => onSelect("remote")}
        />
      </div>
    </div>
  )
}

function ModeCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: typeof ComputerIcon
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-white/10 bg-white/[0.025] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-white/5 text-zinc-400">
          <HugeiconsIcon icon={icon} size={18} />
        </div>
        <p className="text-sm font-medium text-zinc-100">{title}</p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">{description}</p>
    </button>
  )
}

function PromptBox({ title, prompt }: { title: string; prompt: string }) {
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(prompt) } catch {}
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-zinc-300">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={copyPrompt} className="h-7 px-2 text-[11px]">
          <HugeiconsIcon icon={Copy01Icon} size={13} />
          Copy
        </Button>
      </div>
      <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-zinc-400">
        {prompt}
      </pre>
    </div>
  )
}

function ManualFields({
  url,
  token,
  setupMode,
  showToken,
  disabled,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
}: {
  url: string
  token: string
  setupMode: "local" | "remote"
  showToken: boolean
  disabled: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="middleware-url" className="text-xs">Middleware URL</Label>
        <Input
          id="middleware-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="http://127.0.0.1:8787 or https://server.example.com"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="middleware-token" className="text-xs">
          {setupMode === "local" ? "Pairing code (not needed locally)" : "Pairing code"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="middleware-token"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            type={showToken ? "text" : "password"}
            placeholder={setupMode === "local" ? "Auto-filled after connect" : "ABC-123"}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => onShowTokenChange(!showToken)} disabled={disabled}>
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
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={22} />
      </div>
      <p className="mt-3 text-sm font-medium text-emerald-100">Workspace ready</p>
      <p className="mt-1 text-xs leading-relaxed text-emerald-100/60">
        OpenClaw is connected to {url || "Middleware"}. Projects, terminal, git, chats, and files will run there.
      </p>
      <Button
        onClick={onDisconnect}
        disabled={busy}
        variant="outline"
        size="sm"
        className="mt-4 border-emerald-500/20 text-emerald-200 hover:bg-emerald-500/10"
      >
        <HugeiconsIcon icon={Unlink03Icon} size={14} />
        {disconnecting ? "Disconnecting..." : "Disconnect"}
      </Button>
    </div>
  )
}
