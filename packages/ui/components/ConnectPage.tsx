"use client"

import { useEffect, useState } from "react"
import { emit } from "@/lib/events"
import { ConnectPageView } from "@/components/connect/ConnectPageView"
import {
  clearMiddlewareConnection,
  getMiddlewareConnection,
  saveMiddlewareConnection,
  testMiddlewareConnection,
  claimMiddlewarePairing,
  detectLocalMiddleware,
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

type DetectMessage = { ok: boolean; text: string }

function statusFromConnection(connected: boolean, url?: string, token?: string): ConnectionStatus {
  return {
    gatewayConfigured: Boolean(url && token),
    gatewayUrl: url ?? null,
    gatewayToken: token ? "configured" : null,
    hasConnection: connected,
    status: connected ? "connected" : url && token ? "configured" : "disconnected",
  }
}

export default function ConnectPage() {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [showToken, setShowToken] = useState(false)
  const [setupMode, setSetupMode] = useState<"local" | "remote">("local")
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [sessionConnected, setSessionConnected] = useState(false)
  const [detectMessage, setDetectMessage] = useState<DetectMessage | null>({ ok: true, text: "Checking for a local workspace service..." })

  useEffect(() => {
    const saved = getMiddlewareConnection()
    if (saved) {
      setUrl(saved.url)
      setToken(saved.token)
      setStatus(statusFromConnection(true, saved.url, saved.token))
      setSessionConnected(true)
    } else {
      setStatus(statusFromConnection(false))
      detectLocalMiddleware().then((detected) => {
        if (!detected) {
          setDetectMessage({ ok: false, text: "No local Middleware found yet. Choose local setup or connect a server." })
          return
        }
        saveMiddlewareConnection(detected)
        setUrl(detected.url)
        setToken(detected.token)
        setStatus(statusFromConnection(true, detected.url, detected.token))
        setSessionConnected(true)
        setConnectResult({ ok: true, url: detected.url, message: "Local Middleware detected" })
        setDetectMessage({ ok: true, text: "Local workspace ready." })
        emit("sidebar:refresh")
        window.dispatchEvent(new CustomEvent("openclaw:middleware-connected"))
      })
    }
    setLoadingStatus(false)
  }, [])

  async function runTest(save: boolean) {
    if (!url.trim() || !token.trim()) {
      setError("Both Middleware URL and token are required")
      return null
    }
    let connection = { url: url.trim(), token: token.trim() }
    let health: MiddlewareHealth | null = null
    if (setupMode === "remote" && token.trim() && !token.trim().startsWith("sk-") && token.trim().length <= 32) {
      const paired = await claimMiddlewarePairing({ url: url.trim(), code: token.trim() })
      connection = { url: paired.url, token: paired.token }
      health = await testMiddlewareConnection(connection)
    } else {
      health = await testMiddlewareConnection(connection)
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
      setError(err instanceof Error ? err.message : String(err))
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
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError(null)
    setConnectResult(null)
    setDetectMessage(null)
    clearMiddlewareConnection()
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
      autoDetect={false}
      detecting={false}
      detectMessage={detectMessage}
      onUrlChange={(value) => { setUrl(value); setError(null); setConnectResult(null) }}
      onTokenChange={(value) => { setToken(value); setError(null); setConnectResult(null) }}
      onShowTokenChange={setShowToken}
      onSetupModeChange={(mode) => {
        setSetupMode(mode)
        setDetectMessage(null)
        setError(null)
        setConnectResult(null)
        if (mode === "local" && !url.trim()) setUrl("http://127.0.0.1:8787")
      }}
      onAutoDetectChange={async () => {
        setDetectMessage({ ok: true, text: "Checking for a local Middleware..." })
        const detected = await detectLocalMiddleware()
        if (!detected) {
          setDetectMessage({ ok: false, text: setupMode === "local" ? "Local Middleware is not running yet. Start OpenClaw locally, or use the advanced command below." : "Run the installer on your server, then paste the Middleware URL and pairing code." })
          return
        }
        saveMiddlewareConnection(detected)
        setUrl(detected.url)
        setToken(detected.token)
        setStatus(statusFromConnection(true, detected.url, detected.token))
        setSessionConnected(true)
        setConnectResult({ ok: true, url: detected.url, message: "Local Middleware detected" })
        setDetectMessage({ ok: true, text: "Local workspace ready." })
        emit("sidebar:refresh")
        window.dispatchEvent(new CustomEvent("openclaw:middleware-connected"))
      }}
      onTest={handleTest}
      onSave={handleSave}
      onDisconnect={handleDisconnect}
    />
  )
}
