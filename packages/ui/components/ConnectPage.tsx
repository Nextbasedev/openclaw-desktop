"use client"

import { useEffect, useState } from "react"
import { emit } from "@/lib/events"
import { ConnectPageView } from "@/components/connect/ConnectPageView"
import {
  clearMiddlewareConnection,
  getMiddlewareConnection,
  saveMiddlewareConnection,
  testMiddlewareConnection,
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
  const [detectMessage, setDetectMessage] = useState<DetectMessage | null>(null)

  useEffect(() => {
    const saved = getMiddlewareConnection()
    if (saved) {
      setUrl(saved.url)
      setToken(saved.token)
      setStatus(statusFromConnection(true, saved.url, saved.token))
      setSessionConnected(true)
    } else {
      setStatus(statusFromConnection(false))
    }
    setLoadingStatus(false)
  }, [])

  async function runTest(save: boolean) {
    if (!url.trim() || !token.trim()) {
      setError("Both Middleware URL and token are required")
      return null
    }
    const health: MiddlewareHealth = await testMiddlewareConnection({ url: url.trim(), token: token.trim() })
    if (save) saveMiddlewareConnection({ url: url.trim(), token: token.trim() })
    setStatus(statusFromConnection(save, url.trim(), token.trim()))
    setConnectResult({ ok: true, url: url.trim(), message: `${health.service} ${health.version}` })
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
      onSetupModeChange={setSetupMode}
      onAutoDetectChange={() => setDetectMessage({ ok: false, text: "Auto-detect is replaced by Middleware URL in new architecture." })}
      onTest={handleTest}
      onSave={handleSave}
      onDisconnect={handleDisconnect}
    />
  )
}
