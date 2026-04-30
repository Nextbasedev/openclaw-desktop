"use client"

import { useCallback, useEffect, useState } from "react"
import { invoke } from "@/lib/ipc"
import { emit } from "@/lib/events"
import { ConnectPageView } from "@/components/connect/ConnectPageView"

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

export default function ConnectPage() {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [showToken, setShowToken] = useState(false)

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const checkStatus = useCallback(async () => {
    try {
      const s = await invoke<ConnectionStatus>("middleware_connect_status", {
        input: {},
      })
      setStatus(s)
      if (s.gatewayUrl) setUrl(s.gatewayUrl)
      if (s.gatewayToken) setToken(s.gatewayToken)
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
      await invoke("middleware_onboarding_save_gateway_config", {
        input: { gatewayUrl: url.trim(), token: token.trim() },
      })
      await invoke("middleware_onboarding_generate_identity", { input: {} })
      const result = await invoke<ConnectResult>("middleware_connect_test", {
        input: {},
      })
      setConnectResult(result)
      await checkStatus()
      if (result.ok) await syncAfterConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError(null)
    setConnectResult(null)
    try {
      await invoke("middleware_connect_disconnect", { input: {} })
      setUrl("")
      setToken("")
      await checkStatus()
      emit("sidebar:refresh")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDisconnecting(false)
    }
  }

  async function syncAfterConnect() {
    try {
      await invoke("middleware_connect_bootstrap", { input: {} })
    } catch {}
    try {
      await invoke("middleware_sync_pull_now", { input: {} })
    } catch {}
    emit("sidebar:refresh")
  }

  async function handleSave() {
    if (!url.trim() || !token.trim()) {
      setError("Both URL and token are required")
      return
    }

    setSaving(true)
    setError(null)

    try {
      await invoke("middleware_onboarding_save_gateway_config", {
        input: { gatewayUrl: url.trim(), token: token.trim() },
      })
      await invoke("middleware_onboarding_generate_identity", { input: {} })
      await checkStatus()
      await syncAfterConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConnectPageView
      url={url}
      token={token}
      showToken={showToken}
      status={status}
      connectResult={connectResult}
      error={error}
      testing={testing}
      saving={saving}
      disconnecting={disconnecting}
      loadingStatus={loadingStatus}
      onUrlChange={(value) => {
        setUrl(value)
        setError(null)
        setConnectResult(null)
      }}
      onTokenChange={(value) => {
        setToken(value)
        setError(null)
        setConnectResult(null)
      }}
      onShowTokenChange={setShowToken}
      onTest={handleTest}
      onSave={handleSave}
      onDisconnect={handleDisconnect}
    />
  )
}
