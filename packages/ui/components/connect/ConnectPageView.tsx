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

const LOCAL_OPENCLAW_PROMPT = `Set up OpenClaw Desktop local connection on this machine.

Use this repo/branch:
https://github.com/Nextbasedev/openclaw-desktop.git
branch: dixit_changes

Requirements:
1. Check whether the OpenClaw Gateway/runtime is running locally. If it is not running, start it.
2. Start OpenClaw Desktop Middleware for this repo on 127.0.0.1:8787.
3. Test http://127.0.0.1:8787/health and make sure openclaw.connected is true.
4. Test http://127.0.0.1:8787/pairing/local from the same computer. It must return ok, mode local, URL, and a middleware token.
5. If any local error says pairing required, unauthorized, forbidden, invalid token, gateway not connected, or approvals required, inspect the OpenClaw gateway/codebase and fix the local same-computer path without weakening VPS/remote pairing security.
6. Keep remote/VPS behavior unchanged: remote still uses Middleware URL + pairing code.

When finished, give me only:
READY` 

const VPS_OPENCLAW_PROMPT = `Set up OpenClaw Desktop Middleware on this VPS.

Use this repo/branch:
https://github.com/Nextbasedev/openclaw-desktop.git
branch: new-arch

Requirements:
1. Install or update the Middleware from this repo.
2. Run it as an auto-restarting service so it survives crashes and reboot.
3. Confirm the OpenClaw Gateway/runtime is running on this VPS.
4. Choose the best URL that my Desktop can reach:
   - If this VPS has a domain with HTTPS, use https://domain.com
   - If using Tailscale, use the Tailscale MagicDNS name or 100.x.y.z address
   - If only LAN/private network, use the reachable private IP
   - If public IP is exposed, use http://PUBLIC_IP:8787 or the configured reverse proxy URL
5. If using firewall/security group, allow the Middleware port or configure reverse proxy.
6. Test /health from the chosen URL and make sure openclaw.connected is true.

When finished, give me only:
Middleware URL: <reachable-url>
Pairing code: <code>
Network note: <public domain | tailscale | private ip | public ip | reverse proxy>`

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
                <p className="text-xl font-semibold tracking-tight text-white">Where is OpenClaw running?</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  Choose where OpenClaw runs. Desktop must be able to reach that machine over your network.
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
                    token={token}
                    showToken={showToken}
                    busy={busy}
                    saving={saving}
                    missingConfig={missingConfig}
                    loadingStatus={loadingStatus}
                    detectMessage={detectMessage}
                    onBack={() => onSetupModeChange("choice")}
                    onDetect={() => onAutoDetectChange(true)}
                    onUrlChange={onUrlChange}
                    onTokenChange={onTokenChange}
                    onShowTokenChange={onShowTokenChange}
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
                    onBack={() => onSetupModeChange("choice")}
                    onUrlChange={onUrlChange}
                    onTokenChange={onTokenChange}
                    onShowTokenChange={onShowTokenChange}
                    onSave={onSave}
                  />
                )}

                {setupMode !== "choice" && (
                <details className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <summary className="cursor-pointer select-none text-sm font-medium text-zinc-300 hover:text-white">
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
                      <Button onClick={onTest} disabled={busy || missingConfig} variant="outline" size="sm">
                        {testing ? "Testing..." : "Test"}
                      </Button>
                      <Button onClick={onSave} disabled={busy || missingConfig} size="sm">
                        {saving ? "Connecting..." : "Save"}
                      </Button>
                    </div>
                  </div>
                </details>
                )}
              </>
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
      <p className="text-center text-xs text-zinc-500">
        Pick one. The next screen will guide that setup.
      </p>
    </div>
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
        "rounded-md border p-4 text-left transition-all",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
          : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("flex size-9 items-center justify-center rounded-md", active ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-zinc-400")}>
          <HugeiconsIcon icon={icon} size={18} />
        </div>
        <p className="text-sm font-medium text-zinc-100">{title}</p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">{description}</p>
    </button>
  )
}

function LocalOpenClawPanel({
  url,
  token,
  showToken,
  busy,
  saving,
  missingConfig,
  loadingStatus,
  detectMessage,
  onBack,
  onDetect,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onSave,
}: {
  url: string
  token: string
  showToken: boolean
  busy: boolean
  saving: boolean
  missingConfig: boolean
  loadingStatus: boolean
  detectMessage: DetectMessage | null
  onBack: () => void
  onDetect: () => void
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSave: () => void
}) {
  const checking = busy || loadingStatus
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="h-7 w-fit px-2 text-xs text-zinc-400">← Back</Button>
      <StepBadge step="2" label="Check local OpenClaw" />
      <div>
        <p className="text-sm font-medium text-zinc-100">We’ll look for OpenClaw on this machine.</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          If OpenClaw is running on this computer, Desktop connects locally. No pairing code or token needed.
        </p>
      </div>
      <StatusMessage message={detectMessage} fallback="Checking for local OpenClaw..." />
      <Button type="button" onClick={onDetect} disabled={checking} className="w-full">
        {checking ? "Checking..." : "Start / detect local backend"}
      </Button>
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-medium text-zinc-300">Manual local URL</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Only use this if auto-detect cannot find the local Middleware. Leave pairing/token empty for local setup.
        </p>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="local-middleware-url" className="text-xs text-zinc-300">Middleware URL</Label>
            <Input
              id="local-middleware-url"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="http://127.0.0.1:8787"
              disabled={busy}
              className="border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <Button onClick={onSave} disabled={busy || missingConfig} className="w-full" size="sm">
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
  onBack: () => void
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onSave: () => void
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <Button type="button" variant="ghost" size="sm" onClick={props.onBack} className="h-7 w-fit px-2 text-xs text-zinc-400">← Back</Button>
      <StepBadge step="2" label="Prepare the VPS" />
      <PromptBox
        title="Ask OpenClaw on your VPS:"
        prompt={VPS_OPENCLAW_PROMPT}
      />
      <StepBadge step="3" label="Paste the result" />
      <ManualFields
        url={props.url}
        token={props.token}
        showToken={props.showToken}
        disabled={props.busy}
        tokenLabel="Pairing code"
        tokenPlaceholder="ABC-123"
        onUrlChange={props.onUrlChange}
        onTokenChange={props.onTokenChange}
        onShowTokenChange={props.onShowTokenChange}
      />
      <Button onClick={props.onSave} disabled={props.busy || props.missingConfig} className="w-full">
        {props.saving ? "Pairing..." : "Pair and continue"}
      </Button>
    </div>
  )
}


function StepBadge({ step, label }: { step: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] text-emerald-300">{step}</span>
      {label}
    </div>
  )
}

function StatusMessage({ message, fallback }: { message: DetectMessage | null; fallback: string }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2 text-xs leading-relaxed", message?.ok ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-amber-500/20 bg-amber-500/5 text-amber-300")}>
      {message?.text || fallback}
    </div>
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
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="middleware-url" className="text-xs">Middleware URL</Label>
        <Input
          id="middleware-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://domain.com or http://100.x.y.z:8787"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="middleware-token" className="text-xs">{tokenLabel}</Label>
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
