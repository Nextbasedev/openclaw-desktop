"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

type DetectMessage = { ok: boolean; text: string }

const AUTO_DETECT_KEY = "jarvis.autoDetect"
const GATEWAY_ACTIVE_KEY = "jarvis.gatewayActive"

export default function ConnectPage() {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [showToken, setShowToken] = useState(false)

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const [autoDetect, setAutoDetect] = useState(() => {
    try {
      return localStorage.getItem(AUTO_DETECT_KEY) === "true"
    } catch {
      return false
    }
  })
  const [detecting, setDetecting] = useState(false)
  const [detectMessage, setDetectMessage] =
    useState<DetectMessage | null>(null)
  const [sessionConnected, setSessionConnected] = useState(false)
  const mountDetectDone = useRef(false)

  const configReady = Boolean(
    status?.gatewayConfigured && status?.hasIdentity,
  )
  const isConnected = configReady && (sessionConnected || autoDetect)

  const checkStatus = useCallback(async () => {
    try {
      const s = await invoke<ConnectionStatus>(
        "middleware_connect_status",
        { input: {} },
      )
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

  async function syncAfterConnect() {
    try {
      await invoke("middleware_connect_bootstrap", { input: {} })
    } catch {}
    try {
      await invoke("middleware_sync_pull_now", { input: {} })
    } catch {}
    try {
      localStorage.setItem(GATEWAY_ACTIVE_KEY, "true")
    } catch {}
    emit("sidebar:refresh")
  }

  const detectAndConnect = useCallback(async () => {
    setDetecting(true)
    setDetectMessage(null)
    setError(null)
    setConnectResult(null)
    try {
      const s = await invoke<ConnectionStatus>(
        "middleware_connect_status",
        { input: {} },
      )
      if (s.gatewayUrl && s.gatewayToken) {
        setUrl(s.gatewayUrl)
        setToken(s.gatewayToken)
        if (s.gatewayConfigured && s.hasIdentity) {
          await syncAfterConnect()
          await checkStatus()
          setSessionConnected(true)
          setDetectMessage({
            ok: true,
            text: "Connected to local gateway",
          })
        } else {
          await invoke(
            "middleware_onboarding_save_gateway_config",
            {
              input: {
                gatewayUrl: s.gatewayUrl,
                token: s.gatewayToken,
              },
            },
          )
          await invoke("middleware_onboarding_generate_identity", {
            input: {},
          })
          await checkStatus()
          await syncAfterConnect()
          setSessionConnected(true)
          setDetectMessage({
            ok: true,
            text: "Gateway detected and connected",
          })
        }
      } else if (s.gatewayUrl) {
        setUrl(s.gatewayUrl)
        setDetectMessage({
          ok: false,
          text: "Gateway URL found but token missing. Enter token manually.",
        })
      } else {
        setDetectMessage({
          ok: false,
          text: "No OpenClaw gateway config found on this device",
        })
      }
    } catch {
      setDetectMessage({
        ok: false,
        text: "Failed to read local OpenClaw config",
      })
    } finally {
      setDetecting(false)
    }
  }, [checkStatus])

  useEffect(() => {
    if (mountDetectDone.current || loadingStatus) return
    if (autoDetect && !isConnected) {
      mountDetectDone.current = true
      detectAndConnect()
    } else {
      mountDetectDone.current = true
    }
  }, [autoDetect, loadingStatus, isConnected, detectAndConnect])

  function handleAutoDetectChange(enabled: boolean) {
    setAutoDetect(enabled)
    try {
      localStorage.setItem(AUTO_DETECT_KEY, String(enabled))
    } catch {}
    if (enabled && !isConnected) {
      detectAndConnect()
    } else if (!enabled) {
      setDetectMessage(null)
    }
  }

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
      await invoke("middleware_onboarding_generate_identity", {
        input: {},
      })
      const result = await invoke<ConnectResult>(
        "middleware_connect_test",
        { input: {} },
      )
      setConnectResult(result)
      await checkStatus()
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
      await invoke("middleware_onboarding_save_gateway_config", {
        input: { gatewayUrl: url.trim(), token: token.trim() },
      })
      await invoke("middleware_onboarding_generate_identity", {
        input: {},
      })
      await checkStatus()
      await syncAfterConnect()
      setSessionConnected(true)
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
    try {
      await invoke("middleware_connect_disconnect", { input: {} })
      setUrl("")
      setToken("")
      setSessionConnected(false)
      try {
        localStorage.setItem(GATEWAY_ACTIVE_KEY, "false")
      } catch {}
      await checkStatus()
      emit("sidebar:refresh")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDisconnecting(false)
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
      isConnected={isConnected}
      autoDetect={autoDetect}
      detecting={detecting}
      detectMessage={detectMessage}
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
      onAutoDetectChange={handleAutoDetectChange}
      onTest={handleTest}
      onSave={handleSave}
      onDisconnect={handleDisconnect}
    />
  )
}
