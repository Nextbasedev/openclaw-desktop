"use client"

import { useEffect, useState } from "react"
import { emit } from "@/lib/events"
import { routeUrl } from "@/lib/app-router"
import { ConnectPageView } from "@/components/connect/ConnectPageView"
import {
  clearMiddlewareConnection,
  getMiddlewareConnection,
  saveMiddlewareConnection,
  testMiddlewareConnection,
  claimMiddlewarePairing,
  detectLocalMiddleware,
  isOpenClawConnected,
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

function isLoopbackMiddlewareUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === "127.0.0.1" || host === "localhost" || host === "tauri.localhost" || host === "::1" || host === "0.0.0.0"
  } catch {
    return false
  }
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

function redirectToDashboard() {
  window.setTimeout(() => {
    window.history.replaceState(null, "", routeUrl("/"))
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, 0)
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
  const [detectMessage, setDetectMessage] = useState<DetectMessage | null>({ ok: true, text: "Checking for a local workspace service..." })

  useEffect(() => {
    async function initializeConnection() {
      const saved = getMiddlewareConnection()
      if (saved) {
        setUrl(saved.url)
        setToken(saved.token)
        try {
          const health = await testMiddlewareConnection(saved)
          if (!isOpenClawConnected(health)) {
            setSessionConnected(false)
            setStatus(statusFromConnection(false, saved.url, saved.token))
            setConnectResult(null)
            setDetectMessage({ ok: false, text: "Saved Middleware is reachable, but OpenClaw is not connected there. The saved URL/token were kept; retry after OpenClaw starts." })
            return
          }
          setStatus(statusFromConnection(true, saved.url, saved.token))
          setSessionConnected(true)
          setConnectResult({ ok: true, url: saved.url, message: "Saved workspace connection verified" })
          return
        } catch (err) {
          setSessionConnected(false)
          setStatus(statusFromConnection(false, saved.url, saved.token))
          setConnectResult(null)
          const localSaved = isLoopbackMiddlewareUrl(saved.url)
          setSetupMode(localSaved ? "local" : "remote")
          if (isPairingOrAuthError(err)) setToken("")
          setDetectMessage({
            ok: false,
            text: localSaved
              ? "Local Middleware is reachable but not ready. Start OpenClaw locally, then try auto-detect again."
              : "Saved Middleware needs to pair again. Paste the Middleware URL and pairing code.",
          })
          return
        }
      }

      setStatus(statusFromConnection(false))
      const detected = await detectLocalMiddleware()
      if (!detected) {
        setDetectMessage({ ok: false, text: "No local OpenClaw runtime found yet. Start OpenClaw locally, or connect a server." })
        return
      }
      saveMiddlewareConnection(detected)
      setUrl(detected.url)
      setToken(detected.token)
      setStatus(statusFromConnection(true, detected.url, detected.token))
      setSessionConnected(true)
      setConnectResult({ ok: true, url: detected.url, message: "Local Middleware detected" })
      setDetectMessage({ ok: true, text: "Local OpenClaw workspace ready." })
      emit("sidebar:refresh")
      window.dispatchEvent(new CustomEvent("openclaw:middleware-connected"))
      redirectToDashboard()
    }

    initializeConnection().finally(() => setLoadingStatus(false))
  }, [])

  async function runTest(save: boolean) {
    const localUrl = isLoopbackMiddlewareUrl(url)
    if (!url.trim() || (!localUrl && !token.trim())) {
      setError(localUrl ? "Middleware URL is required" : "Both Middleware URL and pairing code/token are required")
      return null
    }
    let connection = { url: url.trim(), token: token.trim() }
    let health: MiddlewareHealth | null = null
    if (!localUrl && isLikelyPairingCode(token)) {
      const paired = await claimMiddlewarePairing({ url: url.trim(), code: token.trim() })
      connection = { url: paired.url, token: paired.token }
      health = await testMiddlewareConnection(connection)
    } else {
      health = await testMiddlewareConnection(connection)
    }
    if (!isOpenClawConnected(health)) {
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
      redirectToDashboard()
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
    setDetectMessage(null)
    clearMiddlewareConnection()
    setUrl("")
    setToken("")
    setSessionConnected(false)
    setStatus(statusFromConnection(false))
    setDetectMessage({ ok: false, text: "Disconnected. Connect manually when ready." })
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
        if (mode === "local") setUrl(url.trim() || "http://127.0.0.1:8787")
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
        setDetectMessage({ ok: true, text: "Local OpenClaw workspace ready." })
        emit("sidebar:refresh")
        window.dispatchEvent(new CustomEvent("openclaw:middleware-connected"))
        redirectToDashboard()
      }}
      onTest={handleTest}
      onSave={handleSave}
      onDisconnect={handleDisconnect}
    />
  )
}
