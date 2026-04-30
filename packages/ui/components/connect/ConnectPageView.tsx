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
  hasIdentity: boolean
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
  status: ConnectionStatus | null
  connectResult: ConnectResult | null
  error: string | null
  testing: boolean
  saving: boolean
  disconnecting: boolean
  loadingStatus: boolean
  onUrlChange: (value: string) => void
  onTokenChange: (value: string) => void
  onShowTokenChange: (show: boolean) => void
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
            : "bg-zinc-600"
        )}
      />
      <span
        className={cn(
          "text-[13px]",
          active ? "text-zinc-200" : "text-zinc-500"
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
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onTest,
  onSave,
  onDisconnect,
}: ConnectPageViewProps) {
  const busy = testing || saving || disconnecting
  const missingConfig = !url.trim() || !token.trim()
  const isReady =
    status?.gatewayConfigured && status.hasIdentity

  return (
    <div className="flex h-svh items-center justify-center overflow-y-auto bg-background p-6">
      <div className="w-full max-w-[960px] space-y-3">
        <div className={cn("overflow-hidden", GLASS_POPOVER)}>
          <div className="grid lg:grid-cols-[310px_1fr]">
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
                  <p className="text-[11px] text-zinc-500">
                    Desktop
                  </p>
                </div>
              </div>

              <div>
                <h1 className="text-lg font-semibold tracking-tight text-white">
                  Connect to Gateway
                </h1>
                <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
                  Configure your gateway to start using
                  agents.
                </p>
              </div>

              <div className="space-y-3">
                <StatusItem
                  active={Boolean(status?.gatewayUrl)}
                  label="Endpoint"
                  value={status?.gatewayUrl}
                />
                <StatusItem
                  active={Boolean(status?.gatewayToken)}
                  label="Auth Token"
                />
                <StatusItem
                  active={Boolean(status?.hasIdentity)}
                  label="Identity"
                />
              </div>
            </div>

            <div className="flex flex-col p-8">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-sm font-medium">
                  Gateway Settings
                </h2>
                {!loadingStatus && status && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      isReady
                        ? "bg-emerald-500/10 text-emerald-400"
                        : status.gatewayConfigured
                          ? "bg-yellow-500/10 text-yellow-400"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        isReady
                          ? "bg-emerald-400"
                          : status.gatewayConfigured
                            ? "bg-yellow-400"
                            : "bg-muted-foreground"
                      )}
                    />
                    {isReady
                      ? "Ready"
                      : status.gatewayConfigured
                        ? "No Identity"
                        : "Not Configured"}
                  </span>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="gateway-url"
                    className="text-xs"
                  >
                    WebSocket URL
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
                      placeholder={
                        status?.gatewayUrl ||
                        "ws://127.0.0.1:18789"
                      }
                      value={url}
                      onChange={(event) =>
                        onUrlChange(event.target.value)
                      }
                      autoComplete="off"
                      spellCheck={false}
                      className="h-9 pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="gateway-token"
                    className="text-xs"
                  >
                    Authentication Token
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
                        type={
                          showToken ? "text" : "password"
                        }
                        placeholder={
                          status?.gatewayToken
                            ? "Token saved"
                            : "Paste your gateway token"
                        }
                        value={token}
                        onChange={(event) =>
                          onTokenChange(event.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className="h-9 pl-9"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={
                        showToken
                          ? "Hide token"
                          : "Show token"
                      }
                      onClick={() =>
                        onShowTokenChange(!showToken)
                      }
                    >
                      <HugeiconsIcon
                        icon={
                          showToken
                            ? ViewOffIcon
                            : EyeIcon
                        }
                        size={15}
                      />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground/60">
                    Found in{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                      ~/.openclaw/openclaw.json
                    </code>
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3 border-t border-border/50 pt-5">
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
                    {saving
                      ? "Saving..."
                      : "Save & Connect"}
                  </Button>
                </div>
                {status?.gatewayConfigured &&
                  status.hasIdentity && (
                    <Button
                      onClick={onDisconnect}
                      disabled={busy}
                      variant="link"
                      size="sm"
                      className="w-full text-destructive hover:text-destructive"
                    >
                      <HugeiconsIcon
                        icon={Unlink03Icon}
                        size={14}
                      />
                      {disconnecting
                        ? "Disconnecting..."
                        : "Disconnect"}
                    </Button>
                  )}
              </div>
            </div>
          </div>
        </div>

        {connectResult?.ok && (
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

        <ConnectionErrorGuide
          result={connectResult}
          rawError={error}
          gatewayUrl={url}
        />
      </div>
    </div>
  )
}
