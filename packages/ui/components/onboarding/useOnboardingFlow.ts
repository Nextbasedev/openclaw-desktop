import { useState, useCallback, useEffect } from "react"

export type OnboardingStep = {
  id: string
  title: string
  complete: boolean
}

export type CoreStatus = {
  node: { installed: boolean; version: string | null }
  npm: { installed: boolean; version: string | null }
  openclaw: { installed: boolean; version: string | null; installMethod: string }
  gateway: { url: string; running: boolean; status: string }
  recommendation: string
}

export type ProviderSummary = {
  id: string
  pluginId: string
  displayName: string
  category: string
  authEnvVars: string[]
  authMethods: string[]
  authChoices: Array<{
    provider: string
    method: string
    optionKey: string | null
    choiceLabel: string
    choiceHint: string
    groupLabel: string
  }>
  submit: {
    payloadShape: {
      values: {
        fields: {
          credentials: CredentialField[]
          config: ConfigField[]
        }
      }
    }
  }
}

export type CredentialField = {
  key: string
  label: string
  help: string | null
  group: string
  authMethod: string
  inputKind: string
  required: boolean
  sensitive: boolean
  envVar: string | null
}

export type ConfigField = {
  key: string
  label: string
  help: string | null
  group: string
  valueType: string
  inputKind: string
  required: boolean
  sensitive: boolean
  enum: string[] | null
  default: unknown
}

export type ModelOption = {
  id: string
  value: string
  label: string
}

export type ModelContract = {
  providerId: string
  authMethod: string | null
  selectedModelRef: string | null
  recommendedModelRef: string | null
  types: {
    payloadShape: {
      modelRef: {
        inputKind: string
        allowCustom: boolean
        recommended: string | null
        options: ModelOption[]
      }
    }
  }
}

export type FlowState = {
  flow: {
    steps: OnboardingStep[]
    nextStep: string
    completed: boolean
  }
  state: {
    core: { status: CoreStatus }
    bot: { botName: string | null }
    provider: { selection: { providerId: string; authMethod: string | null } | null }
    model: { selectedModelRef: string | null; contract: ModelContract | null }
  }
}

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export function useOnboardingFlow() {
  const [flowState, setFlowState] = useState<FlowState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFlow = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await tauriInvoke<FlowState>("middleware_onboarding_flow", { input: {} })
      setFlowState(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFlow()
  }, [loadFlow])

  const checkCore = useCallback(async (action: "check" | "apply") => {
    return tauriInvoke<{
      action: string
      applied: boolean
      canAutoFix: boolean
      status: CoreStatus
      actionsRun: string[]
      message?: string
      manualAction?: string
      docsUrl?: string
    }>("middleware_onboarding_core", { input: { action } })
  }, [])

  const getBotName = useCallback(async () => {
    return tauriInvoke<{ botName: string | null }>("middleware_openclaw_bot_name_get")
  }, [])

  const setBotName = useCallback(async (botName: string) => {
    return tauriInvoke<{ ok: boolean; botName: string }>("middleware_openclaw_bot_name_set", { input: { botName } })
  }, [])

  const getProviders = useCallback(async () => {
    return tauriInvoke<{ providers: ProviderSummary[]; count: number }>("middleware_onboarding_providers", {})
  }, [])

  const getProviderDetails = useCallback(async (providerId: string) => {
    return tauriInvoke<{ provider: ProviderSummary }>("middleware_onboarding_provider_details", { input: { providerId } })
  }, [])

  const submitProvider = useCallback(async (providerId: string, authMethod: string, values: Record<string, string>, setDefault = true) => {
    return tauriInvoke<{ ok: boolean; nextStep: string }>("middleware_onboarding_provider_submit", {
      input: { providerId, authMethod, values, setDefault },
    })
  }, [])

  const getModelContract = useCallback(async (providerId?: string) => {
    return tauriInvoke<{ contract: ModelContract }>("middleware_onboarding_model_contract", {
      input: providerId ? { providerId } : {},
    })
  }, [])

  const submitModel = useCallback(async (modelRef: string, providerId?: string, setDefault = true) => {
    return tauriInvoke<{ ok: boolean; nextStep: string }>("middleware_onboarding_model_submit", {
      input: { modelRef, setDefault, ...(providerId ? { providerId } : {}) },
    })
  }, [])

  const signOut = useCallback(async () => {
    return tauriInvoke<{ ok: boolean; cleared: string[] }>("middleware_onboarding_sign_out")
  }, [])

  const deleteAccount = useCallback(async () => {
    return tauriInvoke<{ ok: boolean; cleared: string[] }>("middleware_onboarding_delete_account")
  }, [])

  return {
    flowState,
    loading,
    error,
    refresh: loadFlow,
    checkCore,
    getBotName,
    setBotName,
    getProviders,
    getProviderDetails,
    submitProvider,
    getModelContract,
    submitModel,
    signOut,
    deleteAccount,
  }
}
