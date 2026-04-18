"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type ConnectionStatus = {
  configured: boolean
  url?: string
  port?: number
  reachable?: boolean
}

type ConnectResult = {
  ok: boolean
  url: string
  serverVersion: string
  agentName: string
  connectedAt: string
}

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export default function ConnectPage() {
  const [url, setUrl] = useState("ws://127.0.0.1:18789")
  const [token, setToken] = useState("3210ebae11309967d69099f8a4b60a67")
  const [showToken, setShowToken] = useState(false)

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const checkStatus = useCallback(async () => {
    try {
      const s = await tauriInvoke<ConnectionStatus>("middleware_gateway_connect_status", {
        input: {},
      })
      setStatus(s)
      if (s.url) setUrl(s.url)
    } catch {
      setStatus(null)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  async function handleTest() {
    if (!url.trim() || !token.trim()) {
      setError("Both URL and token are required")
      return
    }

    setTesting(true)
    setError(null)
    setConnectResult(null)

    try {
      const result = await tauriInvoke<ConnectResult>("middleware_gateway_connect", {
        input: { url: url.trim(), token: token.trim() },
      })
      setConnectResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (!url.trim() || !token.trim()) {
      setError("Both URL and token are required")
      return
    }

    setSaving(true)
    setError(null)

    try {
      await tauriInvoke("middleware_gateway_connect_save", {
        input: { url: url.trim(), token: token.trim() },
      })
      await checkStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6 pt-16">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Connect to Gateway
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your OpenClaw gateway WebSocket URL and authentication token.
          </p>
        </div>

        {/* Status badge */}
        {!loadingStatus && status && (
          <div className="flex items-center gap-2">
            {status.configured && status.reachable ? (
              <Badge variant="default">Connected</Badge>
            ) : status.configured ? (
              <Badge variant="outline">Configured &middot; Unreachable</Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
            {status.url && (
              <span className="font-mono text-xs text-muted-foreground">
                {status.url}
              </span>
            )}
          </div>
        )}

        {/* Connection form */}
        <Card>
          <CardHeader>
            <CardTitle>Gateway Settings</CardTitle>
            <CardDescription>
              The gateway handles all communication with OpenClaw services.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gateway-url">WebSocket URL</Label>
              <Input
                id="gateway-url"
                type="text"
                placeholder="ws://127.0.0.1:18789"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setError(null)
                  setConnectResult(null)
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Accepts ws://, wss://, http://, https://, or bare host:port.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gateway-token">Authentication Token</Label>
              <div className="flex gap-2">
                <Input
                  id="gateway-token"
                  type={showToken ? "text" : "password"}
                  placeholder="Paste your gateway token"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value)
                    setError(null)
                    setConnectResult(null)
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-center"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? "Hide" : "Show"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Found in <code className="rounded bg-muted px-1 py-0.5">~/.openclaw/openclaw.json</code> or your gateway admin panel.
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex gap-2">
            <Button
              onClick={handleTest}
              disabled={testing || saving || !url.trim() || !token.trim()}
              variant="outline"
            >
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || testing || !url.trim() || !token.trim()}
            >
              {saving ? "Saving..." : "Save & Connect"}
            </Button>
          </CardFooter>
        </Card>

        {/* Error */}
        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent>
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Success result */}
        {connectResult && (
          <Card className="border-ring/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Connection Successful
                <Badge variant="default">Online</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Gateway URL</dt>
                <dd className="font-mono">{connectResult.url}</dd>
                <dt className="text-muted-foreground">Server Version</dt>
                <dd className="font-mono">{connectResult.serverVersion}</dd>
                <dt className="text-muted-foreground">Agent Name</dt>
                <dd>{connectResult.agentName}</dd>
                <dt className="text-muted-foreground">Connected At</dt>
                <dd className="font-mono text-xs">
                  {new Date(connectResult.connectedAt).toLocaleString()}
                </dd>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
