"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { invoke } from "@/lib/ipc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const DEFAULT_GATEWAY_PORT = "18789"

type ConnectionStatus = {
  gatewayConfigured: boolean
  gatewayUrl?: string | null
  gatewayToken?: string | null
  hasIdentity: boolean
  isLocal?: boolean
  status: string
}

type ConnectResult = {
  ok: boolean
  url?: string
  message?: string
  error?: string
  isLocal?: boolean
  addedOrigins?: string[]
  fix?: {
    description: string
    origins: string[]
    example: Record<string, unknown>
  }
}

type PathId = "local" | "tailscale" | "public" | "manual"

type StepState = "good" | "warn" | "idle" | "bad"

type DiagnosticStep = {
  label: string
  detail: string
  state: StepState
}

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (/^wss?:\/\//i.test(trimmed)) return trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:")
  }
  return `ws://${trimmed}`
}

function currentHostInfo() {
  if (typeof window === "undefined") {
    return { host: "", isLocal: true, isTailscale: false, protocol: "http:" }
  }
  const host = window.location.hostname
  return {
    host,
    protocol: window.location.protocol,
    isLocal: host === "localhost" || host === "127.0.0.1" || host === "::1",
    isTailscale: host.startsWith("100.") || host.includes(".ts.net"),
  }
}

function stateClass(state: StepState) {
  if (state === "good") return "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
  if (state === "warn") return "border-amber-500/25 bg-amber-500/8 text-amber-300"
  if (state === "bad") return "border-destructive/25 bg-destructive/8 text-destructive"
  return "border-white/10 bg-slate-900/55 text-slate-300"
}

function stateDot(state: StepState) {
  if (state === "good") return "bg-emerald-500"
  if (state === "warn") return "bg-amber-500"
  if (state === "bad") return "bg-destructive"
  return "bg-slate-900-foreground/40"
}

function statusCopy(status: ConnectionStatus | null, result: ConnectResult | null) {
  if (result?.ok) return { label: "Connected", variant: "default" as const }
  if (result && !result.ok) return { label: "Needs fix", variant: "destructive" as const }
  if (status?.gatewayConfigured && status.hasIdentity) return { label: "Ready to test", variant: "secondary" as const }
  if (status?.gatewayConfigured) return { label: "Identity missing", variant: "outline" as const }
  return { label: "Not configured", variant: "outline" as const }
}

function issueMessage(result: ConnectResult | null) {
  if (!result || result.ok) return null
  if (result.error === "origin_fixed_restart") {
    return {
      title: "Access permission fixed — restart needed",
      body: result.message ?? "Allowed origins were added. Restart the gateway and test again.",
      action: "Run openclaw gateway restart, then click Test again.",
    }
  }
  if (result.error === "origin_not_allowed") {
    return {
      title: "This URL is blocked by the gateway",
      body: "The page is reachable, but the gateway rejected this app origin. Add the allowed origins on the machine running OpenClaw.",
      action: "Open Technical details below and copy the config snippet.",
    }
  }
  return {
    title: "Connection test failed",
    body: result.error ?? result.message ?? "Unknown connection error.",
    action: "Check URL/token first. If the page opens but live updates fail, check access permission/origin.",
  }
}

export default function ConnectPage() {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [showToken, setShowToken] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [selectedPath, setSelectedPath] = useState<PathId>("local")

  const hostInfo = useMemo(() => currentHostInfo(), [])
  const normalizedUrl = useMemo(() => normalizeGatewayUrl(url), [url])
  const statusBadge = statusCopy(status, connectResult)
  const issue = issueMessage(connectResult)

  const suggestedUrls = useMemo(() => {
    const tailscaleHost = hostInfo.isTailscale ? hostInfo.host : "100.x.y.z"
    return {
      local: `ws://127.0.0.1:${DEFAULT_GATEWAY_PORT}`,
      tailscale: `ws://${tailscaleHost}:${DEFAULT_GATEWAY_PORT}`,
      public: `wss://gateway.your-domain.com`,
    }
  }, [hostInfo])

  const paths = useMemo(
    () => [
      {
        id: "local" as const,
        title: "Same computer",
        badge: "Easiest",
        description: "OpenClaw and this desktop app are running on the same machine.",
        url: suggestedUrls.local,
      },
      {
        id: "tailscale" as const,
        title: "Private server link",
        badge: "Recommended remote",
        description: "Use Tailscale when OpenClaw is on a server. Private, no public firewall needed.",
        url: suggestedUrls.tailscale,
      },
      {
        id: "public" as const,
        title: "Public domain",
        badge: "Advanced",
        description: "Use a secure custom domain when you intentionally expose a gateway endpoint.",
        url: suggestedUrls.public,
      },
      {
        id: "manual" as const,
        title: "Manual setup",
        badge: "Expert",
        description: "Paste any gateway URL if you already know the exact address.",
        url: status?.gatewayUrl ?? "",
      },
    ],
    [status?.gatewayUrl, suggestedUrls],
  )

  const diagnostics = useMemo<DiagnosticStep[]>(() => {
    const hasUrl = Boolean(normalizedUrl)
    const usesLocal = normalizedUrl.includes("127.0.0.1") || normalizedUrl.includes("localhost")
    const usesTailscale = /ws:\/\/100\.|\.ts\.net/i.test(normalizedUrl)
    const resultState: StepState = connectResult?.ok ? "good" : connectResult ? "bad" : "idle"

    return [
      {
        label: "Gateway address",
        detail: hasUrl ? normalizedUrl : "Choose a path or paste the gateway URL.",
        state: hasUrl ? "good" : "warn",
      },
      {
        label: "Authentication token",
        detail: token ? "Token is present." : "Paste the token from your OpenClaw config.",
        state: token ? "good" : "warn",
      },
      {
        label: "Device identity",
        detail: status?.hasIdentity ? "This device has an identity." : "We will create one when you save/test.",
        state: status?.hasIdentity ? "good" : "idle",
      },
      {
        label: "Network path",
        detail: usesLocal
          ? "Local connection. No Tailscale needed."
          : usesTailscale
            ? "Tailscale/private network path detected."
            : hasUrl
              ? "Remote/custom URL path. Access permission may be required."
              : "Unknown until a URL is selected.",
        state: hasUrl ? (usesLocal || usesTailscale ? "good" : "warn") : "idle",
      },
      {
        label: "Access permission",
        detail: connectResult?.error === "origin_not_allowed"
          ? "Gateway is blocking this app origin."
          : connectResult?.error === "origin_fixed_restart"
            ? "Allowed origins updated; restart required."
            : connectResult?.ok
              ? "Gateway accepted this app."
              : "Checked during Test Connection.",
        state: connectResult?.error === "origin_not_allowed" ? "bad" : connectResult?.error === "origin_fixed_restart" ? "warn" : resultState,
      },
    ]
  }, [connectResult, normalizedUrl, status?.hasIdentity, token])

  const checkStatus = useCallback(async () => {
    try {
      const s = await invoke<ConnectionStatus>("middleware_connect_status", { input: {} })
      setStatus(s)
      if (s.gatewayUrl) setUrl(s.gatewayUrl)
      if (s.gatewayToken) setToken(s.gatewayToken)
      if (s.gatewayUrl?.includes("100.") || s.gatewayUrl?.includes(".ts.net")) setSelectedPath("tailscale")
      else if (s.gatewayUrl?.startsWith("wss://")) setSelectedPath("public")
    } catch {
      setStatus(null)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  function applyPath(path: (typeof paths)[number]) {
    setSelectedPath(path.id)
    if (path.url) setUrl(path.url)
    setError(null)
    setConnectResult(null)
  }

  async function saveConfig() {
    if (!normalizedUrl || !token.trim()) {
      throw new Error("Gateway URL and token are required.")
    }
    await invoke("middleware_onboarding_save_gateway_config", {
      input: { gatewayUrl: normalizedUrl, token: token.trim() },
    })
    await invoke("middleware_onboarding_generate_identity", { input: {} })
  }

  async function handleTest() {
    setTesting(true)
    setError(null)
    setConnectResult(null)

    try {
      await saveConfig()
      const result = await invoke<ConnectResult>("middleware_connect_test", { input: {} })
      setConnectResult(result)
      await checkStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    try {
      await saveConfig()
      await checkStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore clipboard failures; visible text remains copyable
    }
  }

  return (
    <div className="min-h-full bg-[#070b16] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.24),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_30%)] p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs text-slate-400 shadow-sm backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              Smart connection setup
            </div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
              Connect without learning networking.
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400 sm:text-base">
              Pick where OpenClaw is running. We’ll translate the scary parts — origin access, listen address, Tailscale URL, identity, and token — into checks you can fix one by one.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/75 p-3 shadow-sm backdrop-blur">
            <Badge variant={statusBadge.variant} className="border-sky-400/30 bg-sky-500/15 text-sky-100">{statusBadge.label}</Badge>
            <span className="font-mono text-xs text-slate-400">
              {loadingStatus ? "checking..." : status?.gatewayUrl ?? "no gateway saved"}
            </span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-6">
            <Card className="border-white/10 bg-slate-950/80 text-slate-100 shadow-sm backdrop-blur">
              <CardHeader>
                <CardTitle>1. Choose the connection path</CardTitle>
                <CardDescription className="text-slate-400">
                  Tailscale is recommended for server development, but local is simplest when everything runs on one computer.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {paths.map((path) => {
                  const active = selectedPath === path.id
                  return (
                    <button
                      key={path.id}
                      type="button"
                      onClick={() => applyPath(path)}
                      className={`rounded-2xl border p-4 text-left transition hover:border-sky-400/50 hover:bg-sky-500/15 ${
                        active ? "border-sky-400/60 bg-sky-500/15" : "border-white/10 bg-slate-900/45"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">{path.title}</h3>
                          <p className="mt-1 text-xs leading-5 text-slate-400">{path.description}</p>
                        </div>
                        <Badge variant={active ? "default" : "outline"} className="shrink-0 border-white/10 bg-slate-800/80 text-[10px] text-slate-200">
                          {path.badge}
                        </Badge>
                      </div>
                      {path.url && (
                        <p className="mt-3 truncate rounded-lg bg-slate-950/80 px-2 py-1 font-mono text-[11px] text-slate-400">
                          {path.url}
                        </p>
                      )}
                    </button>
                  )
                })}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-slate-950/80 text-slate-100 shadow-sm backdrop-blur">
              <CardHeader>
                <CardTitle>2. Gateway details</CardTitle>
                <CardDescription className="text-slate-400">
                  We normalize URLs automatically. Example: <span className="font-mono">100.x.y.z:18789</span> becomes a WebSocket URL.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="gateway-url">Gateway URL</Label>
                  <Input
                    id="gateway-url"
                    type="text"
                    placeholder="ws://127.0.0.1:18789"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value)
                      setSelectedPath("manual")
                      setError(null)
                      setConnectResult(null)
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>Will use:</span>
                    <code className="rounded bg-slate-900 px-1.5 py-0.5">{normalizedUrl || "—"}</code>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gateway-token">Authentication token</Label>
                  <div className="flex gap-2">
                    <Input
                      id="gateway-token"
                      type={showToken ? "text" : "password"}
                      placeholder={status?.gatewayToken ? "Token saved" : "Paste your gateway token"}
                      value={token}
                      onChange={(event) => {
                        setToken(event.target.value)
                        setError(null)
                        setConnectResult(null)
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                    />
                    <Button type="button" variant="outline" className="border-white/10 bg-slate-900 text-slate-100 hover:bg-slate-800" onClick={() => setShowToken(!showToken)}>
                      {showToken ? "Hide" : "Show"}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Usually in <code className="rounded bg-slate-900 px-1 py-0.5">~/.openclaw/openclaw.json</code>. We only need it to talk to your own gateway.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={handleTest}
                  disabled={testing || saving || !normalizedUrl || !token.trim()}
                  className="w-full bg-sky-500 text-white hover:bg-sky-400 sm:w-auto"
                >
                  {testing ? "Testing path..." : "Test & auto-fix"}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving || testing || !normalizedUrl || !token.trim()}
                  variant="outline"
                  className="w-full border-white/10 bg-slate-900 text-slate-100 hover:bg-slate-800 sm:w-auto"
                >
                  {saving ? "Saving..." : "Save only"}
                </Button>
              </CardFooter>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="overflow-hidden border-white/10 bg-slate-950/80 text-slate-100 shadow-sm backdrop-blur">
              <CardHeader>
                <CardTitle>Connection path</CardTitle>
                <CardDescription className="text-slate-400">What has to work before chat and live updates feel instant.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-3xl border border-white/10 bg-slate-900/45 p-4">
                  <div className="grid gap-2 text-center text-xs font-medium text-slate-400 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
                    <div className="rounded-2xl border border-sky-400/30 bg-sky-500/15 px-3 py-3 text-sky-300">Desktop app</div>
                    <div className="hidden h-px w-8 bg-border sm:block" />
                    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-emerald-300">OpenClaw Gateway</div>
                    <div className="hidden h-px w-8 bg-border sm:block" />
                    <div className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-3 py-3 text-violet-300">
                      {selectedPath === "tailscale" ? "Tailscale private link" : selectedPath === "local" ? "Local machine" : "Remote URL"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {diagnostics.map((step) => (
                    <div key={step.label} className={`rounded-2xl border px-3 py-3 ${stateClass(step.state)}`}>
                      <div className="flex items-start gap-3">
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${stateDot(step.state)}`} />
                        <div>
                          <p className="text-sm font-medium text-slate-100">{step.label}</p>
                          <p className="mt-0.5 text-xs leading-5 text-slate-400">{step.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {(error || issue || connectResult?.ok) && (
              <Card className={connectResult?.ok ? "border-emerald-500/30 bg-emerald-500/10 text-slate-100" : "border-amber-500/30 bg-amber-500/10 text-slate-100"}>
                <CardHeader>
                  <CardTitle className="text-base text-slate-100">
                    {connectResult?.ok ? "Connected successfully" : issue?.title ?? "Check needed"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {connectResult?.ok ? (
                    <>
                      <p>Your gateway accepted this device and URL.</p>
                      <code className="block rounded-lg bg-slate-950/80 px-3 py-2 font-mono text-xs">{connectResult.url ?? normalizedUrl}</code>
                    </>
                  ) : (
                    <>
                      <p>{error ?? issue?.body}</p>
                      {issue?.action && <p className="text-xs text-slate-400">{issue.action}</p>}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-white/10 bg-slate-950/80 text-slate-100 shadow-sm backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Technical details</CardTitle>
                    <CardDescription className="text-slate-400">For when the automatic path needs a manual fix.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="border-white/10 bg-slate-900 text-slate-100 hover:bg-slate-800" onClick={() => setAdvancedOpen(!advancedOpen)}>
                    {advancedOpen ? "Hide" : "Show"}
                  </Button>
                </div>
              </CardHeader>
              {advancedOpen && (
                <CardContent className="space-y-4 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-4">
                    <h3 className="font-medium text-slate-100">If Tailscale page opens but gateway fails</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      The gateway may be listening only on localhost. On the server, bind it to a reachable address or expose it through the intended private interface.
                    </p>
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs"><code>{`# Server-side checks
openclaw gateway status
ss -ltnp | grep 18789
openclaw gateway restart`}</code></pre>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium text-slate-100">Allowed origins snippet</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Needed when the gateway rejects this app origin. Add the exact UI URL you are using.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-white/10 bg-slate-900 text-slate-100 hover:bg-slate-800"
                        onClick={() => copy(JSON.stringify(connectResult?.fix?.example ?? {
                          gateway: {
                            controlUi: {
                              allowedOrigins: [
                                "http://localhost:3000",
                                "http://127.0.0.1:3000",
                                hostInfo.host ? `${hostInfo.protocol}//${hostInfo.host}:3000` : "http://100.x.y.z:3000",
                                "tauri://localhost",
                              ],
                            },
                          },
                        }, null, 2))}
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs"><code>{JSON.stringify(connectResult?.fix?.example ?? {
                      gateway: {
                        controlUi: {
                          allowedOrigins: [
                            "http://localhost:3000",
                            "http://127.0.0.1:3000",
                            hostInfo.host ? `${hostInfo.protocol}//${hostInfo.host}:3000` : "http://100.x.y.z:3000",
                            "tauri://localhost",
                          ],
                        },
                      },
                    }, null, 2)}</code></pre>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current page</p>
                      <p className="mt-2 break-all font-mono text-xs">{hostInfo.host || "unknown"}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-900/45 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Saved status</p>
                      <p className="mt-2 font-mono text-xs">{status?.status ?? "unknown"}</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
