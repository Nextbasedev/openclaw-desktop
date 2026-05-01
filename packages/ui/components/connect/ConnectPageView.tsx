"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  CheckmarkCircle02Icon,
  ComputerIcon,
  ElectricPlugsIcon,
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
  setupMode: "local" | "remote"
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
  onSetupModeChange: (mode: "local" | "remote") => void
  onAutoDetectChange: (enabled: boolean) => void
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}

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
  const isRemote = setupMode === "remote"
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
                <p className="text-xl font-semibold tracking-tight text-white">Set up OpenClaw Desktop</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                  We’ll connect to the workspace service that runs your terminal, git, files, and chats.
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
                <AutoDetectState
                  loadingStatus={loadingStatus}
                  detectMessage={detectMessage}
                  busy={busy}
                  onDetect={() => onAutoDetectChange(true)}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <ModeCard
                    active={setupMode === "local"}
                    icon={ComputerIcon}
                    title="Use this computer"
                    description="Best for local projects and private files. Usually automatic."
                    action="Detect locally"
                    onClick={() => onSetupModeChange("local")}
                  />
                  <ModeCard
                    active={setupMode === "remote"}
                    icon={Globe02Icon}
                    title="Use a server"
                    description="Best for VPS, always-on agents, and remote workspaces."
                    action="Pair server"
                    onClick={() => onSetupModeChange("remote")}
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  {isRemote ? (
                    <RemotePairingForm
                      url={url}
                      token={token}
                      showToken={showToken}
                      busy={busy}
                      testing={testing}
                      saving={saving}
                      missingConfig={missingConfig}
                      onUrlChange={onUrlChange}
                      onTokenChange={onTokenChange}
                      onShowTokenChange={onShowTokenChange}
                      onTest={onTest}
                      onSave={onSave}
                    />
                  ) : (
                    <LocalSetupPanel busy={busy} onDetect={() => onAutoDetectChange(true)} />
                  )}
                </div>

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

function AutoDetectState({
  loadingStatus,
  detectMessage,
  busy,
  onDetect,
}: {
  loadingStatus: boolean
  detectMessage: DetectMessage | null
  busy: boolean
  onDetect: () => void
}) {
  return (
    <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
          {loadingStatus ? (
            <div className="size-4 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-300" />
          ) : (
            <HugeiconsIcon icon={ElectricPlugsIcon} size={17} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">Automatic setup</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {detectMessage?.text || "Checking for a local workspace service..."}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onDetect}>
          Retry
        </Button>
      </div>
    </div>
  )
}

function ModeCard({
  active,
  icon,
  title,
  description,
  action,
  onClick,
}: {
  active: boolean
  icon: typeof ComputerIcon
  title: string
  description: string
  action: string
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
        <div>
          <p className="text-sm font-medium text-zinc-100">{title}</p>
          <p className="mt-0.5 text-[11px] font-medium text-zinc-500">{action}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">{description}</p>
    </button>
  )
}

function LocalSetupPanel({ busy, onDetect }: { busy: boolean; onDetect: () => void }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-100">Use this computer</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          OpenClaw will use Middleware on this machine. In the desktop app this starts automatically; in development, run the local stack once.
        </p>
      </div>
      <Button type="button" onClick={onDetect} disabled={busy} className="w-full">
        {busy ? "Checking..." : "Detect local workspace"}
      </Button>
      <details className="rounded-lg bg-black/20 px-3 py-2">
        <summary className="cursor-pointer text-xs text-zinc-400">Developer command</summary>
        <code className="mt-2 block overflow-x-auto text-xs text-zinc-500">pnpm dev:local</code>
      </details>
    </div>
  )
}

function RemotePairingForm(props: {
  url: string
  token: string
  showToken: boolean
  busy: boolean
  testing: boolean
  saving: boolean
  missingConfig: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onTest: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-zinc-100">Pair a server</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Run the installer on your VPS. It prints a Middleware URL and short pairing code. Paste both here.
        </p>
      </div>
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
      <details className="rounded-lg bg-black/20 px-3 py-2">
        <summary className="cursor-pointer text-xs text-zinc-400">Server install command</summary>
        <code className="mt-2 block overflow-x-auto text-xs text-zinc-500">
          curl -fsSL https://raw.githubusercontent.com/Nextbasedev/openclaw-desktop/new-arch/apps/middleware/scripts/install.sh | bash
        </code>
      </details>
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
