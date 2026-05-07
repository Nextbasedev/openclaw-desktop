"use client"

import { useEffect, useState } from "react"
import { emit } from "@/lib/events"
import { ConnectPageView } from "@/components/connect/ConnectPageView"
import {
  getMiddlewareConnection,
  saveMiddlewareConnection,
  testMiddlewareConnection,
  claimMiddlewarePairing,
  type MiddlewareHealth,
} from "@/lib/middleware-client"

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
}

function statusFromConnection(connected: boolean, url?: string, token?: string): ConnectionStatus {
  return {
    gatewayConfigured: Boolean(url),
    gatewayUrl: url ?? null,
    gatewayToken: token ? "configured" : null,
    hasConnection: connected,
    status: connected ? "connected" : url ? "configured" : "disconnected",
  }
}

function isLikelyPairingCode(value: string): boolean {
  const compact = value.trim().replace(/[-\s]/g, "")
  return /^[A-Z0-9]{4,16}$/i.test(compact) && !compact.toLowerCase().startsWith("sk")
}

function isPairingOrAuthError(err: unknown): boolean {
  const lower = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return lower.includes("pairing") || lower.includes("invalid token") || lower.includes("unauthorized") || lower.includes("forbidden")
}

function humanConnectionError(err: unknown, targetUrl: string): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.toLowerCase().includes("failed to fetch")) {
    return `Could not reach Middleware at ${targetUrl.trim() || "the entered URL"}. Check that this device can access that URL/network, then try again.`
  }
  return message
}

export default function ConnectPage() {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [showToken, setShowToken] = useState(false)
  const [setupMode, setSetupMode] = useState<"choice" | "local" | "remote">("choice")
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [sessionConnected, setSessionConnected] = useState(false)

  useEffect(() => {
    async function initializeConnection() {
      const saved = getMiddlewareConnection()
      if (!saved) {
        setStatus(statusFromConnection(false))
        return
      }

      setUrl(saved.url)
      setToken(saved.token)
      try {
        const health = await testMiddlewareConnection(saved)
        if (!health.openclaw?.connected) {
          setSessionConnected(false)
          setStatus(statusFromConnection(false, saved.url, saved.token))
          setConnectResult(null)
          return
        }
        setStatus(statusFromConnection(true, saved.url, saved.token))
        setSessionConnected(true)
        setSetupMode("remote")
        setConnectResult({ ok: true, url: saved.url, message: "Saved workspace connection verified" })
      } catch (err) {
        setSessionConnected(false)
        setStatus(statusFromConnection(false, saved.url, saved.token))
        setConnectResult(null)
        if (isPairingOrAuthError(err)) setToken("")
      }
    }

    initializeConnection().finally(() => setLoadingStatus(false))
  }, [])

  async function runTest(save: boolean) {
    if (!url.trim() || !token.trim()) {
      setError("Both Middleware URL and pairing code are required")
      return null
    }

    let connection = { url: url.trim(), token: token.trim() }
    let health: MiddlewareHealth | null = null

    if (isLikelyPairingCode(token)) {
      const paired = await claimMiddlewarePairing({ url: connection.url, code: token.trim() })
      connection = { url: paired.url, token: paired.token }
      health = await testMiddlewareConnection(connection)
    } else {
      health = await testMiddlewareConnection(connection)
    }

    if (!health.openclaw?.connected) {
      throw new Error("Middleware is reachable, but OpenClaw is not running there")
    }
    if (save) saveMiddlewareConnection(connection)
    setUrl(connection.url)
    setToken(connection.token)
    setStatus(statusFromConnection(save, connection.url, connection.token))
    setConnectResult({ ok: true, url: connection.url, message: `${health.service} ${health.version}` })
    return health
  }

  async function handleTest() {
    setTesting(true)
    setError(null)
    setConnectResult(null)
    try {
      await runTest(false)
    } catch (err) {
      setError(humanConnectionError(err, url))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await runTest(true)
      setSessionConnected(true)
      emit("sidebar:refresh")
      window.dispatchEvent(new CustomEvent("openclaw:middleware-connected"))
    } catch (err) {
      setError(humanConnectionError(err, url))
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError(null)
    setConnectResult(null)
    if (typeof window !== "undefined") {
      localStorage.removeItem("openclaw.middleware.url")
      localStorage.removeItem("openclaw.middleware.token")
      localStorage.setItem("jarvis.gatewayActive", "false")
    }
    setUrl("")
    setToken("")
    setSessionConnected(false)
    setStatus(statusFromConnection(false))
    emit("sidebar:refresh")
    setDisconnecting(false)
  }

  return (
    <ConnectPageView
      url={url}
      token={token}
      showToken={showToken}
      setupMode={setupMode}
      status={status}
      connectResult={connectResult}
      error={error}
      testing={testing}
      saving={saving}
      disconnecting={disconnecting}
      loadingStatus={loadingStatus}
      isConnected={sessionConnected}
      onUrlChange={(value) => { setUrl(value); setError(null); setConnectResult(null) }}
      onTokenChange={(value) => { setToken(value); setError(null); setConnectResult(null) }}
      onShowTokenChange={setShowToken}
      onSetupModeChange={(mode) => {
        setSetupMode(mode)
        setError(null)
        setConnectResult(null)
        if (mode === "local" && !url.trim()) setUrl("http://127.0.0.1:8787")
      }}
      onTest={handleTest}
      onSave={handleSave}
      onDisconnect={handleDisconnect}
    />
  )
}
