"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  CheckmarkCircle02Icon,
  ElectricPlugsIcon,
  EyeIcon,
  FloppyDiskIcon,
  Globe02Icon,
  Key01Icon,
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
  onAutoDetectChange: (enabled: boolean) => void
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}

function StatusItem({
  active,
  label,
  value,
}: {
  active: boolean
  label: string
  value?: string | null
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          active
            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
            : "bg-zinc-600",
        )}
      />
      <span
        className={cn(
          "text-[13px]",
          active ? "text-zinc-200" : "text-zinc-500",
        )}
      >
        {label}
      </span>
      {value && (
        <span className="ml-auto max-w-[140px] truncate text-[11px] text-zinc-500">
          {value}
        </span>
      )}
    </div>
  )
}

export function ConnectPageView({
  url,
  token,
  showToken,
  status,
  connectResult,
  error,
  testing,
  saving,
  disconnecting,
  loadingStatus,
  isConnected,
  autoDetect,
  detecting,
  detectMessage,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onAutoDetectChange,
  onTest,
  onSave,
  onDisconnect,
}: ConnectPageViewProps) {
  const busy = testing || saving || disconnecting || detecting

  return (
    <div className="flex h-svh items-center justify-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-[960px] space-y-3">
        <div className={cn("overflow-hidden", GLASS_POPOVER)}>
          <div className="grid lg:grid-cols-[310px_1fr]">
            <LeftPanel
              status={status}
              loadingStatus={loadingStatus}
              isConnected={isConnected}
            />
            <RightPanel
              url={url}
              token={token}
              showToken={showToken}
              isConnected={isConnected}
              autoDetect={autoDetect}
              detecting={detecting}
              detectMessage={detectMessage}
              busy={busy}
              testing={testing}
              saving={saving}
              disconnecting={disconnecting}
              onUrlChange={onUrlChange}
              onTokenChange={onTokenChange}
              onShowTokenChange={onShowTokenChange}
              onAutoDetectChange={onAutoDetectChange}
              onTest={onTest}
              onSave={onSave}
              onDisconnect={onDisconnect}
            />
          </div>
        </div>

        {isConnected && connectResult?.ok && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-400">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={15}
              className="shrink-0"
            />
            Connected to{" "}
            <span className="font-medium">
              {connectResult.url}
            </span>
          </div>
        )}

        {!isConnected && (
          <ConnectionErrorGuide
            result={connectResult}
            rawError={error}
            gatewayUrl={url}
          />
        )}
      </div>
    </div>
  )
}

function LeftPanel({
  status,
  loadingStatus,
  isConnected,
}: {
  status: ConnectionStatus | null
  loadingStatus: boolean
  isConnected: boolean
}) {
  return (
    <div className="flex flex-col gap-9 border-b border-white/[0.06] bg-white/[0.02] p-8 lg:border-b-0 lg:border-r lg:border-border/10">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5">
          <HugeiconsIcon
            icon={ServerStack01Icon}
            size={18}
            className="text-zinc-300"
          />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">
            OpenClaw
          </p>
          <p className="text-[11px] text-zinc-500">Desktop</p>
        </div>
      </div>

      <div>
        <h1 className="text-lg font-semibold tracking-tight text-white">
          Connect to Middleware
        </h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
          Connect Desktop to your Node.js Middleware service.
        </p>
      </div>

      <div className="space-y-3">
        <StatusItem
          active={Boolean(status?.gatewayUrl)}
          label="Middleware URL"
          value={status?.gatewayUrl}
        />
        <StatusItem
          active={Boolean(status?.gatewayToken)}
          label="Token"
        />
        <StatusItem
          active={Boolean(status?.hasConnection)}
          label="Connection"
        />
      </div>

      {!loadingStatus && status && (
        <span
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            isConnected
              ? "bg-emerald-500/10 text-emerald-400"
              : status.gatewayConfigured
                ? "bg-yellow-500/10 text-yellow-400"
                : "bg-muted text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isConnected
                ? "bg-emerald-400"
                : status.gatewayConfigured
                  ? "bg-yellow-400"
                  : "bg-muted-foreground",
            )}
          />
          {isConnected
            ? "Connected"
            : status.gatewayConfigured
              ? "No Connection"
              : "Not Configured"}
        </span>
      )}
    </div>
  )
}

function RightPanel({
  url,
  token,
  showToken,
  isConnected,
  autoDetect,
  detecting,
  detectMessage,
  busy,
  testing,
  saving,
  disconnecting,
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onAutoDetectChange,
  onTest,
  onSave,
  onDisconnect,
}: {
  url: string
  token: string
  showToken: boolean
  isConnected: boolean
  autoDetect: boolean
  detecting: boolean
  detectMessage: DetectMessage | null
  busy: boolean
  testing: boolean
  saving: boolean
  disconnecting: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
  onAutoDetectChange: (enabled: boolean) => void
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}) {
  const missingConfig = !url.trim() || !token.trim()

  return (
    <div className="flex flex-col p-8">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-medium">
          Middleware Settings
        </h2>
      </div>

      <div className="space-y-4">
        <AutoDetectToggle
          enabled={autoDetect}
          detecting={detecting}
          detectMessage={detectMessage}
          disabled={isConnected}
          onChange={onAutoDetectChange}
        />

        <div className="space-y-1.5">
          <Label htmlFor="gateway-url" className="text-xs">
            Middleware URL
          </Label>
          <div className="relative">
            <HugeiconsIcon
              icon={Globe02Icon}
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="gateway-url"
              type="text"
              placeholder="http://host:8787"
              value={url}
              onChange={(event) =>
                onUrlChange(event.target.value)
              }
              autoComplete="off"
              spellCheck={false}
              disabled={isConnected}
              className={cn(
                "h-9 pl-9",
                isConnected && "opacity-60",
              )}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="gateway-token"
            className="text-xs"
          >
            Middleware Token
          </Label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <HugeiconsIcon
                icon={Key01Icon}
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="gateway-token"
                type={showToken ? "text" : "password"}
                placeholder="Paste your middleware token"
                value={token}
                onChange={(event) =>
                  onTokenChange(event.target.value)
                }
                autoComplete="off"
                spellCheck={false}
                disabled={isConnected}
                className={cn(
                  "h-9 pl-9",
                  isConnected && "opacity-60",
                )}
              />
            </div>
            {!isConnected && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={
                  showToken ? "Hide token" : "Show token"
                }
                onClick={() =>
                  onShowTokenChange(!showToken)
                }
              >
                <HugeiconsIcon
                  icon={showToken ? ViewOffIcon : EyeIcon}
                  size={15}
                />
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60">
            Generated by the Middleware installer
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-border/50 pt-5">
        {isConnected ? (
          <Button
            onClick={onDisconnect}
            disabled={busy}
            variant="outline"
            size="sm"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <HugeiconsIcon icon={Unlink03Icon} size={14} />
            {disconnecting
              ? "Disconnecting..."
              : "Disconnect"}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={onTest}
              disabled={busy || missingConfig}
              variant="outline"
              size="sm"
              className="w-full"
            >
              <HugeiconsIcon
                icon={ElectricPlugsIcon}
                size={15}
              />
              {testing ? "Testing..." : "Test"}
            </Button>
            <Button
              onClick={onSave}
              disabled={busy || missingConfig}
              size="sm"
              className="w-full"
            >
              <HugeiconsIcon
                icon={FloppyDiskIcon}
                size={15}
              />
              {saving ? "Connecting..." : "Connect"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function AutoDetectToggle({
  enabled,
  detecting,
  detectMessage,
  disabled,
  onChange,
}: {
  enabled: boolean
  detecting: boolean
  detectMessage: DetectMessage | null
  disabled: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-[13px] font-medium text-zinc-200">
            Install Middleware
          </p>
          <p className="text-[11px] text-zinc-500">
            Run the installer on your VPS/local machine and paste URL + token
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={disabled}
          onClick={() => onChange(!enabled)}
          className={cn(
            "flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-1 transition-all",
            enabled
              ? "bg-emerald-500/20 ring-1 ring-emerald-500/30"
              : "bg-white/5 ring-1 ring-white/10 hover:bg-white/10",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <div
            className={cn(
              "h-4 w-4 rounded-full shadow-sm transition-all duration-300",
              enabled
                ? "translate-x-4 bg-emerald-500 shadow-emerald-500/40"
                : "translate-x-0 bg-zinc-500",
            )}
          />
        </button>
      </div>

      {detecting && (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <div className="size-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          Detecting local gateway...
        </div>
      )}

      {!detecting && detectMessage && (
        <p
          className={cn(
            "text-[11px]",
            detectMessage.ok
              ? "text-emerald-400"
              : "text-amber-400",
          )}
        >
          {detectMessage.text}
        </p>
      )}
    </div>
  )
}
