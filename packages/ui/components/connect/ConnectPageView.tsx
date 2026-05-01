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

const LOCAL_OPENCLAW_PROMPT = `Set up OpenClaw Desktop on this machine.

1. Check whether the OpenClaw Gateway/runtime is running locally.
2. If it is not running, start it.
3. Then start OpenClaw Desktop Middleware for this repo on port 8787.
4. When it is ready, give me only: READY` 

const VPS_OPENCLAW_PROMPT = `Set up OpenClaw Desktop Middleware on this VPS.

Use this repo/branch:
https://github.com/Nextbasedev/openclaw-desktop.git
branch: new-arch

Install and start the Middleware as an auto-restarting service.
When finished, give me only:
Middleware URL: <url>
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
  const missingConfig = !url.trim() || !token.trim()

  return (
    <div className="flex min-h-svh items-center justify-center overflow-y-auto bg-background p-4 sm:p-6">
      <div className="w-full max-w-[720px] space-y-4">
        <div className={cn("overflow-hidden p-6 sm:p-8", GLASS_POPOVER)}>
          <div className="mx-auto max-w-[560px] space-y-6">
            <header className="space-y-3 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <HugeiconsIcon icon={ServerStack01Icon} size={22} className="text-zinc-200" />
              </div>
              <div>
                <p className="text-xl font-semibold tracking-tight text-white">Where is OpenClaw running?</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  Choose the machine that already has OpenClaw, then Desktop will pair with it.
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
                    busy={busy}
                    loadingStatus={loadingStatus}
                    detectMessage={detectMessage}
                    onBack={() => onSetupModeChange("choice")}
                    onDetect={() => onAutoDetectChange(true)}
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
        "rounded-2xl border p-4 text-left transition-all",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
          : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("flex size-9 items-center justify-center rounded-xl", active ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-zinc-400")}>
          <HugeiconsIcon icon={icon} size={18} />
        </div>
        <p className="text-sm font-medium text-zinc-100">{title}</p>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">{description}</p>
    </button>
  )
}

function LocalOpenClawPanel({
  busy,
  loadingStatus,
  detectMessage,
  onBack,
  onDetect,
}: {
  busy: boolean
  loadingStatus: boolean
  detectMessage: DetectMessage | null
  onBack: () => void
  onDetect: () => void
}) {
  const checking = busy || loadingStatus
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="h-7 w-fit px-2 text-xs text-zinc-400">← Back</Button>
      <StepBadge step="2" label="Check local OpenClaw" />
      <div>
        <p className="text-sm font-medium text-zinc-100">We’ll look for OpenClaw on this machine.</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          If OpenClaw is running, Desktop will pair automatically. No URL or token needed.
        </p>
      </div>
      <StatusMessage message={detectMessage} fallback="Checking for local OpenClaw..." />
      <Button type="button" onClick={onDetect} disabled={checking} className="w-full">
        {checking ? "Checking..." : "Retry detection"}
      </Button>
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
          placeholder="https://your-server.com"
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
