import { jest } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as onboarding from "../../services/onboarding.service.js"
import * as connection from "../../db/connection.js"
import { setAppSetting } from "../../db/helpers.js"

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
})

afterEach(() => {
  connection.closeDb()
  try { fs.unlinkSync(testDbPath) } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

describe("onboardingStatus", () => {
  it("returns not_started initially", () => {
    const result = onboarding.onboardingStatus()
    expect(result.step).toBe("not_started")
    expect(result.isComplete).toBe(false)
    expect(result.completedAt).toBeNull()
  })
})

describe("onboardingSetStep", () => {
  it("sets and persists step", () => {
    onboarding.onboardingSetStep({ step: "gateway_config" })
    const result = onboarding.onboardingStatus()
    expect(result.step).toBe("gateway_config")
  })
})

describe("onboardingComplete", () => {
  it("marks onboarding as complete", () => {
    onboarding.onboardingComplete()
    const result = onboarding.onboardingStatus()
    expect(result.step).toBe("complete")
    expect(result.isComplete).toBe(true)
    expect(result.completedAt).toBeTruthy()
  })
})

describe("onboardingReset", () => {
  it("resets to not_started", () => {
    onboarding.onboardingComplete()
    onboarding.onboardingReset()
    const result = onboarding.onboardingStatus()
    expect(result.step).toBe("not_started")
  })
})

describe("onboardingCheckGateway", () => {
  it("returns config status", () => {
    const result = onboarding.onboardingCheckGateway()
    expect(result).toHaveProperty("hasConfig")
    expect(result).toHaveProperty("configPath")
  })
})

describe("onboardingCheckIdentity", () => {
  it("returns identity status", () => {
    const result = onboarding.onboardingCheckIdentity()
    expect(result).toHaveProperty("hasIdentity")
    expect(result).toHaveProperty("identityPath")
  })
})

describe("onboardingCheckWorkspace", () => {
  it("returns workspace status", () => {
    const result = onboarding.onboardingCheckWorkspace()
    expect(result).toHaveProperty("hasWorkspace")
    expect(result).toHaveProperty("workspacePath")
  })
})

describe("onboardingValidateGatewayUrl", () => {
  it("validates https URL", () => {
    const result = onboarding.onboardingValidateGatewayUrl({ url: "https://gateway.openclaw.dev" })
    expect(result.valid).toBe(true)
  })

  it("validates wss URL", () => {
    const result = onboarding.onboardingValidateGatewayUrl({ url: "wss://gateway.openclaw.dev" })
    expect(result.valid).toBe(true)
  })

  it("rejects invalid URL", () => {
    const result = onboarding.onboardingValidateGatewayUrl({ url: "ftp://invalid" })
    expect(result.valid).toBe(false)
  })

  it("rejects empty URL", () => {
    expect(() => onboarding.onboardingValidateGatewayUrl({ url: "  " })).toThrow("URL cannot be empty")
  })
})

describe("onboardingCheckDependencies", () => {
  it("checks for git, node, npm", () => {
    const result = onboarding.onboardingCheckDependencies()
    expect(result.dependencies).toHaveLength(3)
    const git = result.dependencies.find((d) => d.name === "git")
    expect(git).toBeTruthy()
    const node = result.dependencies.find((d) => d.name === "node")
    expect(node?.installed).toBe(true)
  })
})

describe("onboardingCreateWorkspace", () => {
  it("creates workspace directory", () => {
    const result = onboarding.onboardingCreateWorkspace()
    expect(result.created).toBe(true)
    expect(fs.existsSync(result.workspacePath)).toBe(true)
  })
})

// ===================== New ported command tests =====================

describe("titleCaseProviderId", () => {
  it("converts hyphenated id to title case", () => {
    expect(onboarding.titleCaseProviderId("openai-codex")).toBe("Openai Codex")
  })

  it("handles single word", () => {
    expect(onboarding.titleCaseProviderId("anthropic")).toBe("Anthropic")
  })

  it("handles empty string", () => {
    expect(onboarding.titleCaseProviderId("")).toBe("")
  })
})

describe("onboardingProviderCategory", () => {
  it("classifies core providers", () => {
    expect(onboarding.onboardingProviderCategory("openai")).toBe("core")
    expect(onboarding.onboardingProviderCategory("anthropic")).toBe("core")
    expect(onboarding.onboardingProviderCategory("deepseek")).toBe("core")
  })

  it("classifies local providers", () => {
    expect(onboarding.onboardingProviderCategory("ollama")).toBe("local")
    expect(onboarding.onboardingProviderCategory("lmstudio")).toBe("local")
  })

  it("classifies unknown providers as advanced", () => {
    expect(onboarding.onboardingProviderCategory("custom-provider")).toBe("advanced")
  })
})

describe("onboardingModelOptionsForProvider", () => {
  it("returns model options for openai", () => {
    const options = onboarding.onboardingModelOptionsForProvider("openai")
    expect(options.length).toBeGreaterThan(0)
    expect(options[0].id).toContain("openai/")
    expect(options[0]).toHaveProperty("value")
    expect(options[0]).toHaveProperty("label")
  })

  it("returns cli models for anthropic with cli auth", () => {
    const options = onboarding.onboardingModelOptionsForProvider("anthropic", "cli")
    expect(options.some((o) => (o.id as string).startsWith("claude-cli/"))).toBe(true)
  })

  it("returns api models for anthropic with api-key auth", () => {
    const options = onboarding.onboardingModelOptionsForProvider("anthropic", "api-key")
    expect(options.some((o) => (o.id as string).startsWith("anthropic/"))).toBe(true)
  })

  it("returns empty for unknown provider", () => {
    const options = onboarding.onboardingModelOptionsForProvider("nonexistent")
    expect(options).toEqual([])
  })
})

describe("readOpenclawProviderManifests", () => {
  it("reads manifests from extensions directory", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    expect(Array.isArray(manifests)).toBe(true)
    if (manifests.length > 0) {
      expect(manifests[0]).toHaveProperty("id")
    }
  })

  it("returns sorted manifests", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    if (manifests.length >= 2) {
      const ids = manifests.map((m) => m.id as string)
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
    }
  })
})

describe("flattenConfigSchemaFields", () => {
  it("flattens nested schema properties", () => {
    const schema = {
      properties: {
        apiKey: { type: "string" },
        nested: {
          type: "object",
          properties: {
            inner: { type: "number" },
          },
        },
      },
      required: ["apiKey"],
    }
    const output: Array<Record<string, unknown>> = []
    onboarding.flattenConfigSchemaFields(null, schema, {}, output)
    expect(output.length).toBeGreaterThanOrEqual(2)
    const apiKeyField = output.find((f) => f.path === "apiKey")
    expect(apiKeyField?.required).toBe(true)
    expect(apiKeyField?.type).toBe("string")
  })

  it("handles empty schema", () => {
    const output: Array<Record<string, unknown>> = []
    onboarding.flattenConfigSchemaFields(null, {}, {}, output)
    expect(output).toEqual([])
  })

  it("applies ui hints", () => {
    const schema = {
      properties: {
        secret: { type: "string" },
      },
    }
    const uiHints = {
      secret: { label: "API Secret", help: "Your secret key", sensitive: true },
    }
    const output: Array<Record<string, unknown>> = []
    onboarding.flattenConfigSchemaFields(null, schema, uiHints, output)
    expect(output[0].label).toBe("API Secret")
    expect(output[0].help).toBe("Your secret key")
    expect(output[0].sensitive).toBe(true)
  })
})

describe("onboardingProviders", () => {
  it("returns providers list", () => {
    const result = onboarding.onboardingProviders()
    expect(result).toHaveProperty("providers")
    expect(result).toHaveProperty("count")
    expect(Array.isArray(result.providers)).toBe(true)
    expect(result.count).toBe(result.providers.length)
  })

  it("providers are sorted by id", () => {
    const result = onboarding.onboardingProviders()
    if (result.providers.length >= 2) {
      const ids = result.providers.map((p) => p.id as string)
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
    }
  })

  it("each provider has expected shape", () => {
    const result = onboarding.onboardingProviders()
    for (const provider of result.providers) {
      expect(provider).toHaveProperty("id")
      expect(provider).toHaveProperty("pluginId")
      expect(provider).toHaveProperty("displayName")
      expect(provider).toHaveProperty("category")
      expect(provider).toHaveProperty("authMethods")
      expect(provider).toHaveProperty("submit")
    }
  })
})

describe("onboardingProviderTypes", () => {
  it("returns provider type schemas", () => {
    const result = onboarding.onboardingProviderTypes()
    expect(result).toHaveProperty("version")
    expect(result).toHaveProperty("submitEndpoint")
    expect(result).toHaveProperty("providers")
    expect(result.submitEndpoint).toBe("middleware_onboarding_provider_submit")
  })

  it("providers have type info", () => {
    const result = onboarding.onboardingProviderTypes()
    for (const provider of result.providers) {
      expect(provider).toHaveProperty("providerId")
      expect(provider).toHaveProperty("displayName")
      expect(provider).toHaveProperty("types")
    }
  })
})

describe("onboardingProviderDetails", () => {
  it("returns details for known provider", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    if (manifests.length === 0) return
    const firstProvider = (manifests[0].providers as string[])?.[0]
    if (!firstProvider) return

    const result = onboarding.onboardingProviderDetails({ providerId: firstProvider })
    expect(result.provider).toHaveProperty("id")
    expect(result.provider.id).toBe(firstProvider)
  })

  it("throws for unknown provider", () => {
    expect(() =>
      onboarding.onboardingProviderDetails({ providerId: "zzz_nonexistent" }),
    ).toThrow("Unsupported OpenClaw provider")
  })
})

describe("providerSubmitSchemaFromManifest", () => {
  it("builds submit schema for anthropic", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    const anthropic = manifests.find((m) => {
      const providers = m.providers as string[] | undefined
      return providers?.includes("anthropic")
    })
    if (!anthropic) return

    const schema = onboarding.providerSubmitSchemaFromManifest(anthropic, "anthropic")
    expect(schema.providerId).toBe("anthropic")
    expect(schema).toHaveProperty("payloadShape")
    expect(schema).toHaveProperty("stepKind")
    expect(schema).toHaveProperty("typeNames")
  })
})

describe("onboardingModelContract", () => {
  it("throws when no provider selected", () => {
    expect(() => onboarding.onboardingModelContract()).toThrow("No onboarding provider selected yet")
  })

  it("returns contract after provider is set", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    if (manifests.length === 0) return
    const firstProvider = (manifests[0].providers as string[])?.[0]
    if (!firstProvider) return

    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", firstProvider)
    setAppSetting(db, "onboarding.provider.auth_method", "")

    const result = onboarding.onboardingModelContract()
    expect(result.contract).toHaveProperty("providerId")
    expect(result.contract.providerId).toBe(firstProvider)
    expect(result.contract).toHaveProperty("submitEndpoint")
  })

  it("accepts explicit providerId", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    if (manifests.length === 0) return
    const firstProvider = (manifests[0].providers as string[])?.[0]
    if (!firstProvider) return

    const result = onboarding.onboardingModelContract({ providerId: firstProvider })
    expect(result.contract.providerId).toBe(firstProvider)
  })
})

describe("onboardingModelSubmit", () => {
  it("throws when no provider selected and no providerId given", () => {
    expect(() =>
      onboarding.onboardingModelSubmit({ modelRef: "openai/gpt-5.4" }),
    ).toThrow("No onboarding provider selected yet")
  })

  it("rejects empty modelRef", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")
    setAppSetting(db, "onboarding.provider.auth_method", "")

    expect(() =>
      onboarding.onboardingModelSubmit({ modelRef: "  " }),
    ).toThrow("modelRef is required")
  })

  it("rejects modelRef with path traversal", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")

    expect(() =>
      onboarding.onboardingModelSubmit({ modelRef: "openai/../etc" }),
    ).toThrow("Invalid model reference")
  })

  it("rejects modelRef without slash", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")

    expect(() =>
      onboarding.onboardingModelSubmit({ modelRef: "gpt-5.4" }),
    ).toThrow("provider/model format")
  })

  it("rejects modelRef for wrong provider", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")

    expect(() =>
      onboarding.onboardingModelSubmit({ modelRef: "anthropic/claude-sonnet-4-6" }),
    ).toThrow("does not belong to selected provider")
  })

  it("saves model ref to config and db", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    const hasOpenai = manifests.some((m) =>
      (m.providers as string[])?.includes("openai"),
    )
    if (!hasOpenai) return

    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")
    setAppSetting(db, "onboarding.provider.auth_method", "")

    const result = onboarding.onboardingModelSubmit({
      modelRef: "openai/gpt-5.4",
    })
    expect(result.ok).toBe(true)
    expect(result.modelRef).toBe("openai/gpt-5.4")
    expect(result.nextStep).toBe("complete")
    expect(result).toHaveProperty("contract")
  })
})

describe("onboardingProviderSubmit", () => {
  it("throws for unknown provider", () => {
    expect(() =>
      onboarding.onboardingProviderSubmit({ providerId: "zzz_fake" }),
    ).toThrow("Unsupported OpenClaw provider")
  })

  it("requires authMethod when multiple exist", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    const anthropicManifest = manifests.find((m) =>
      (m.providers as string[])?.includes("anthropic"),
    )
    if (!anthropicManifest) return

    const authChoices = (anthropicManifest.providerAuthChoices ?? []) as Array<
      Record<string, unknown>
    >
    const anthropicMethods = authChoices
      .filter((c) => c.provider === "anthropic")
      .map((c) => c.method)
      .filter(Boolean)

    if (anthropicMethods.length > 1) {
      expect(() =>
        onboarding.onboardingProviderSubmit({ providerId: "anthropic" }),
      ).toThrow("requires authMethod")
    }
  })

  it("rejects unsupported authMethod", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    const hasAnthropic = manifests.some((m) =>
      (m.providers as string[])?.includes("anthropic"),
    )
    if (!hasAnthropic) return

    expect(() =>
      onboarding.onboardingProviderSubmit({
        providerId: "anthropic",
        authMethod: "fingerprint",
      }),
    ).toThrow("Unsupported authMethod")
  })

  it("saves provider selection to db", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    const hasAnthropic = manifests.some((m) =>
      (m.providers as string[])?.includes("anthropic"),
    )
    if (!hasAnthropic) return

    const result = onboarding.onboardingProviderSubmit({
      providerId: "anthropic",
      authMethod: "api-key",
      values: { anthropicApiKey: "sk-test-key-12345" },
    })
    expect(result.ok).toBe(true)
    expect(result.providerId).toBe("anthropic")
    expect(result.nextStep).toBe("model-selection")
    expect(result.saved.envVars.length).toBeGreaterThanOrEqual(0)
  })
})

describe("onboardingCore", () => {
  it("returns check result with status", () => {
    const result = onboarding.onboardingCore({})
    expect(result.action).toBe("check")
    expect(result).toHaveProperty("status")
    expect(result.status).toHaveProperty("node")
    expect(result.status).toHaveProperty("npm")
    expect(result.status).toHaveProperty("openclaw")
    expect(result.status).toHaveProperty("gateway")
    expect(result.status).toHaveProperty("recommendation")
  })

  it("returns canAutoFix flag", () => {
    const result = onboarding.onboardingCore({ action: "check" })
    expect(typeof result.canAutoFix).toBe("boolean")
  })

  it("detects node as installed", () => {
    const result = onboarding.onboardingCore({})
    const nodeStatus = result.status.node as Record<string, unknown>
    expect(nodeStatus.installed).toBe(true)
    expect(typeof nodeStatus.version).toBe("string")
  })
})

describe("onboardingFlow", () => {
  it("returns flow with steps and state", () => {
    const result = onboarding.onboardingFlow()
    expect(result).toHaveProperty("flow")
    expect(result).toHaveProperty("state")
    expect(result.flow).toHaveProperty("steps")
    expect(result.flow).toHaveProperty("nextStep")
    expect(result.flow).toHaveProperty("completed")

    const steps = result.flow.steps as Array<Record<string, unknown>>
    expect(steps).toHaveLength(4)
    const stepIds = steps.map((s) => s.id)
    expect(stepIds).toEqual(["core", "bot", "provider", "model"])
  })

  it("state includes all sections", () => {
    const result = onboarding.onboardingFlow()
    expect(result.state).toHaveProperty("core")
    expect(result.state).toHaveProperty("bot")
    expect(result.state).toHaveProperty("provider")
    expect(result.state).toHaveProperty("model")
    expect(result.state.core).toHaveProperty("checkEndpoint")
    expect(result.state.bot).toHaveProperty("getEndpoint")
    expect(result.state.provider).toHaveProperty("listEndpoint")
    expect(result.state.model).toHaveProperty("contractEndpoint")
  })

  it("reflects provider selection in state", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    const hasOpenai = manifests.some((m) =>
      (m.providers as string[])?.includes("openai"),
    )
    if (!hasOpenai) return

    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")
    setAppSetting(db, "onboarding.provider.auth_method", "api-key")

    const result = onboarding.onboardingFlow()
    expect(result.state.provider.selection).not.toBeNull()
    const selection = result.state.provider.selection as Record<string, unknown>
    expect(selection.providerId).toBe("openai")
  })
})

describe("onboardingSignOut", () => {
  it("clears onboarding settings", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.provider.id", "openai")
    setAppSetting(db, "openclaw.bot_name", "TestBot")
    setAppSetting(db, "onboarding.step", "complete")

    const result = onboarding.onboardingSignOut()
    expect(result.ok).toBe(true)

    const status = onboarding.onboardingStatus()
    expect(status.step).toBe("not_started")
  })

  it("preserves non-onboarding settings", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.step", "complete")
    setAppSetting(db, "custom.setting", "keep-me")

    onboarding.onboardingSignOut()

    const db2 = connection.getDb()
    const row = db2
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get("custom.setting") as { value: string } | undefined
    expect(row?.value).toBe("keep-me")
  })
})

describe("onboardingDeleteAccount", () => {
  it("clears all app_settings", () => {
    const db = connection.getDb()
    setAppSetting(db, "onboarding.step", "complete")
    setAppSetting(db, "custom.setting", "value")

    const result = onboarding.onboardingDeleteAccount()
    expect(result.ok).toBe(true)

    const db2 = connection.getDb()
    const count = db2.prepare("SELECT COUNT(*) as c FROM app_settings").get() as { c: number }
    expect(count.c).toBe(0)
  })
})

describe("providerSummaryFromManifest", () => {
  it("builds summary with expected fields", () => {
    const manifests = onboarding.readOpenclawProviderManifests()
    if (manifests.length === 0) return
    const firstProvider = (manifests[0].providers as string[])?.[0]
    if (!firstProvider) return

    const summary = onboarding.providerSummaryFromManifest(manifests[0], firstProvider)
    expect(summary).toHaveProperty("id")
    expect(summary).toHaveProperty("pluginId")
    expect(summary).toHaveProperty("displayName")
    expect(summary).toHaveProperty("category")
    expect(summary).toHaveProperty("authEnvVars")
    expect(summary).toHaveProperty("authMethods")
    expect(summary).toHaveProperty("submit")
  })
})
