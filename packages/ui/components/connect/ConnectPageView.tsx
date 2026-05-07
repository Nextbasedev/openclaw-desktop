"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  EyeIcon,
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
  onTest: () => void
  onSave: () => void
  onDisconnect: () => void
}

const OPENCLAW_CONNECT_PROMPT = `Set up OpenClaw Desktop Middleware and give me the connection details.

Use this repo/branch:
https://github.com/Nextbasedev/openclaw-desktop.git
branch: dixit_changes

Requirements:
1. Install or update OpenClaw Desktop Middleware from this repo.
2. Make sure the OpenClaw Gateway/runtime is running on the same machine as the Middleware.
3. Start the Middleware and expose a URL that this Desktop app can reach.
   - Local computer: http://127.0.0.1:8787
   - VPS/domain/Tailscale: use the reachable URL for that machine
4. Test /health from that URL and make sure openclaw.connected is true.
5. Give me the Middleware URL and pairing code.
6. If pairing, auth, gateway, token, or network errors appear, fix them in the OpenClaw/Desktop codebase without weakening remote/VPS pairing security.

When finished, give me only:
Middleware URL: <reachable-url>
Pairing code: <code>`

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
  onUrlChange,
  onTokenChange,
  onShowTokenChange,
  onTest,
  onSave,
  onDisconnect,
}: ConnectPageViewProps) {
  const busy = testing || saving || disconnecting || loadingStatus
  const missingConfig = !url.trim() || !token.trim()

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
            ) : (
              <div className="space-y-4">
                <PromptBox
                  title="Ask OpenClaw:"
                  prompt={OPENCLAW_CONNECT_PROMPT}
                />

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-4 space-y-1">
                    <p className="text-sm font-medium text-zinc-100">Paste connection details</p>
                    <p className="text-xs leading-relaxed text-zinc-500">
                      This works for both local and VPS setups. Pairing keeps the token exchange explicit and secure.
                    </p>
                  </div>
                  <ManualFields
                    url={url}
                    token={token}
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
        <Label htmlFor="middleware-token" className="text-xs">Pairing code</Label>
        <div className="flex gap-2">
          <Input
            id="middleware-token"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            type={showToken ? "text" : "password"}
            placeholder="ABC-123"
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
