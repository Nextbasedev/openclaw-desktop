import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import { getDb } from "../db/connection.js"
import { getAppSetting, setAppSetting } from "../db/helpers.js"

const DEFAULT_GATEWAY_PORT = 18789
const APP_SETTING_OPENCLAW_BOT_NAME = "openclaw.bot_name"
const APP_SETTING_ONBOARDING_PROVIDER_ID = "onboarding.provider.id"
const APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD =
  "onboarding.provider.auth_method"
const APP_SETTING_ONBOARDING_PROVIDER_VALUES_PREFIX =
  "onboarding.provider.values."
const APP_SETTING_ONBOARDING_MODEL_REF = "onboarding.model.ref"
const APP_SETTING_ONBOARDING_MODEL_PROVIDER_ID =
  "onboarding.model.provider_id"

function openclawConfigPath(): string {
  return path.join(os.homedir(), ".openclaw", "openclaw.json")
}

function readOpenclawConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(openclawConfigPath(), "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function readOpenclawConfigValue(): Record<string, unknown> {
  return readOpenclawConfig()
}

function writeOpenclawConfigValue(
  config: Record<string, unknown>,
): void {
  const configPath = openclawConfigPath()
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
  )
}

function setJsonPath(
  root: Record<string, unknown>,
  jsonPath: string,
  value: unknown,
): void {
  const parts = jsonPath.split(".").filter((p) => p.length > 0)
  if (parts.length === 0) return

  let current: Record<string, unknown> = root
  for (const part of parts.slice(0, -1)) {
    if (
      typeof current[part] !== "object" ||
      current[part] === null ||
      Array.isArray(current[part])
    ) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  const last = parts[parts.length - 1]
  current[last] = value
}

function valueAtJsonPath(
  root: Record<string, unknown>,
  jsonPath: string,
): unknown | undefined {
  let current: unknown = root
  for (const part of jsonPath.split(".").filter((p) => p.length > 0)) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    )
      return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function commandVersion(
  binary: string,
  versionArg: string,
): string | null {
  try {
    const output = execFileSync(binary, [versionArg], {
      timeout: 5000,
    })
      .toString()
      .trim()
    return output || null
  } catch {
    return null
  }
}

function openclawExtensionsDir(): string {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "..",
    "..",
    ".openclaw-src",
    "extensions",
  )
}

export function titleCaseProviderId(providerId: string): string {
  return providerId
    .split("-")
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
}

function providerTypeName(
  providerId: string,
  suffix: string,
): string {
  return (
    providerId
      .split("-")
      .filter((p) => p.length > 0)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") + suffix
  )
}

export function onboardingProviderCategory(
  providerId: string,
): string {
  const core = new Set([
    "openai",
    "openai-codex",
    "anthropic",
    "google",
    "google-gemini-cli",
    "openrouter",
    "deepseek",
    "mistral",
    "xai",
    "qwen",
    "moonshot",
    "together",
  ])
  const local = new Set([
    "ollama",
    "lmstudio",
    "vllm",
    "sglang",
    "github-copilot",
    "codex",
    "copilot-proxy",
    "opencode",
    "opencode-go",
    "kilocode",
  ])
  if (core.has(providerId)) return "core"
  if (local.has(providerId)) return "local"
  return "advanced"
}

function inferAuthMethodFromEnvVar(envVar: string): string {
  if (envVar.includes("OAUTH")) return "oauth"
  if (envVar.startsWith("AWS_")) return "aws-sdk"
  if (envVar.includes("TOKEN")) return "token"
  return "api-key"
}

function preferredEnvVarForAuthMethod(
  authMethod: string,
  authEnvVars: string[],
): string | null {
  const needleMap: Record<string, string> = {
    oauth: "OAUTH",
    token: "TOKEN",
    device: "TOKEN",
    "aws-sdk": "AWS_",
  }
  const needle = needleMap[authMethod] ?? "API_KEY"

  const found = authEnvVars.find((v) =>
    needle === "AWS_" ? v.startsWith("AWS_") : v.includes(needle),
  )
  return found ?? authEnvVars[0] ?? null
}

function fieldInputKind(
  fieldType: string,
  hasEnum: boolean,
  sensitive: boolean,
): string {
  if (sensitive) return "secret"
  if (hasEnum) return "select"
  if (fieldType.includes("boolean")) return "toggle"
  if (
    fieldType.includes("number") ||
    fieldType.includes("integer")
  )
    return "number"
  if (fieldType === "object") return "group"
  return "text"
}

function isLeafField(
  configFields: Array<Record<string, unknown>>,
  fieldPath: string,
): boolean {
  return !configFields.some((candidate) => {
    const other = candidate.path as string | undefined
    return other && other !== fieldPath && other.startsWith(fieldPath + ".")
  })
}

export function flattenConfigSchemaFields(
  prefix: string | null,
  schema: Record<string, unknown>,
  uiHints: Record<string, unknown>,
  output: Array<Record<string, unknown>>,
): void {
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined
  if (!properties) return

  const requiredArr = (schema.required as string[]) ?? []
  const requiredSet = new Set(requiredArr)

  for (const [key, fieldSchema] of Object.entries(properties)) {
    const fieldPath =
      prefix && prefix.length > 0 ? `${prefix}.${key}` : key

    const hint = uiHints[fieldPath] as
      | Record<string, unknown>
      | undefined
    const label = hint?.label as string | undefined
    const help = hint?.help as string | undefined

    let fieldType: string
    const rawType = fieldSchema.type
    if (typeof rawType === "string") {
      fieldType = rawType
    } else if (Array.isArray(rawType)) {
      fieldType = rawType.filter((t) => typeof t === "string").join("|")
    } else {
      fieldType = "object"
    }

    output.push({
      path: fieldPath,
      type: fieldType,
      required: requiredSet.has(key),
      label: label ?? null,
      help: help ?? null,
      enum: fieldSchema.enum ?? null,
      default: fieldSchema.default ?? null,
      sensitive: (hint?.sensitive as boolean) ?? false,
    })

    if (rawType === "object" || fieldSchema.properties) {
      flattenConfigSchemaFields(
        fieldPath,
        fieldSchema as Record<string, unknown>,
        uiHints,
        output,
      )
    }
  }
}

export function readOpenclawProviderManifests(): Array<
  Record<string, unknown>
> {
  const extDir = openclawExtensionsDir()
  if (!fs.existsSync(extDir)) return []

  const manifests: Array<Record<string, unknown>> = []
  for (const entry of fs.readdirSync(extDir)) {
    const manifestPath = path.join(
      extDir,
      entry,
      "openclaw.plugin.json",
    )
    if (!fs.existsSync(manifestPath)) continue
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8")
      manifests.push(JSON.parse(raw) as Record<string, unknown>)
    } catch {
      continue
    }
  }
  manifests.sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? "")),
  )
  return manifests
}

function manifestForProvider(
  providerId: string,
): Record<string, unknown> {
  const manifests = readOpenclawProviderManifests()
  const found = manifests.find((m) => {
    const providers = m.providers as string[] | undefined
    return providers?.includes(providerId) ?? false
  })
  if (!found)
    throw new Error(`Unsupported OpenClaw provider: ${providerId}`)
  return found
}

function buildProviderAuthFields(
  authChoices: Array<Record<string, unknown>>,
  authEnvVars: string[],
): Array<Record<string, unknown>> {
  const fields: Array<Record<string, unknown>> = []
  const usedEnvVars = new Set<string>()

  for (const choice of authChoices) {
    const authMethod =
      (choice.method as string | undefined) ?? "api-key"
    const optionKey = choice.optionKey as string | undefined
    const envVar = preferredEnvVarForAuthMethod(
      authMethod,
      authEnvVars,
    )
    if (envVar) usedEnvVars.add(envVar)

    fields.push({
      key: optionKey ?? authMethod,
      label:
        choice.choiceLabel ?? titleCaseProviderId(authMethod),
      help: choice.choiceHint ?? null,
      group: "credentials",
      authMethod,
      valueType: "string",
      inputKind: authMethod === "oauth" ? "action" : "secret",
      required:
        optionKey !== undefined && authMethod !== "oauth",
      sensitive: authMethod !== "oauth",
      envVar,
      optionKey: optionKey ?? null,
      cliFlag: choice.cliFlag ?? null,
    })
  }

  for (const envVar of authEnvVars) {
    if (usedEnvVars.has(envVar)) continue
    const authMethod = inferAuthMethodFromEnvVar(envVar)
    fields.push({
      key: envVar,
      label: titleCaseProviderId(envVar),
      help: null,
      group: "credentials",
      authMethod,
      valueType: "string",
      inputKind: authMethod === "oauth" ? "action" : "secret",
      required:
        authMethod !== "oauth" && authMethod !== "aws-sdk",
      sensitive: authMethod !== "oauth",
      envVar,
      optionKey: null,
      cliFlag: null,
    })
  }

  return fields
}

function buildProviderConfigInputFields(
  configFields: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return configFields
    .filter((field) => {
      const p = field.path as string | undefined
      return p ? isLeafField(configFields, p) : false
    })
    .map((field) => {
      const fieldType =
        (field.type as string | undefined) ?? "string"
      const sensitive =
        (field.sensitive as boolean | undefined) ?? false
      const hasEnum = Array.isArray(field.enum)
      return {
        key: field.path ?? null,
        sourcePath: field.path ?? null,
        label: field.label ?? field.path ?? null,
        help: field.help ?? null,
        group: "config",
        valueType: fieldType,
        inputKind: fieldInputKind(fieldType, hasEnum, sensitive),
        required: field.required ?? false,
        sensitive: field.sensitive ?? false,
        enum: field.enum ?? null,
        default: field.default ?? null,
      }
    })
}

export function providerSubmitSchemaFromManifest(
  manifest: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> {
  const allAuthChoices = (manifest.providerAuthChoices ??
    []) as Array<Record<string, unknown>>
  const authChoices = allAuthChoices.filter(
    (c) => c.provider === providerId,
  )
  const authEnvVarsMap = (manifest.providerAuthEnvVars ?? {}) as Record<
    string,
    string[]
  >
  const authEnvVars = authEnvVarsMap[providerId] ?? []
  const authMethods = authChoices
    .map((c) => c.method)
    .filter(Boolean)
  const configSchema = (manifest.configSchema ??
    {}) as Record<string, unknown>
  const uiHints = (manifest.uiHints ?? {}) as Record<
    string,
    unknown
  >
  const configFields: Array<Record<string, unknown>> = []
  flattenConfigSchemaFields(
    null,
    configSchema,
    uiHints,
    configFields,
  )
  const credentialFields = buildProviderAuthFields(
    authChoices,
    authEnvVars,
  )
  const configInputFields =
    buildProviderConfigInputFields(configFields)
  const category = onboardingProviderCategory(providerId)
  let stepKind: string
  if (category === "local") stepKind = "local"
  else if (category === "advanced") stepKind = "advanced"
  else if (authMethods.some((m) => m === "oauth"))
    stepKind = "mixed"
  else stepKind = "api-key"

  return {
    providerId,
    submitEndpoint: "middleware_onboarding_provider_submit",
    stepKind,
    typeNames: {
      payload: providerTypeName(
        providerId,
        "OnboardingSubmitPayload",
      ),
      authMethod: providerTypeName(providerId, "AuthMethod"),
      values: providerTypeName(
        providerId,
        "OnboardingValues",
      ),
    },
    payloadShape: {
      providerId: { type: "literal", value: providerId },
      authMethod: { type: "enum", options: authMethods },
      setDefault: { type: "boolean", default: true },
      values: {
        type: "object",
        fields: {
          credentials: credentialFields,
          config: configInputFields,
        },
      },
    },
  }
}

export function providerSummaryFromManifest(
  manifest: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> {
  const pluginId = (manifest.id as string) ?? ""
  const allAuthChoices = (manifest.providerAuthChoices ??
    []) as Array<Record<string, unknown>>
  const authChoices = allAuthChoices.filter(
    (c) => c.provider === providerId,
  )
  const authEnvVarsMap = (manifest.providerAuthEnvVars ?? {}) as Record<
    string,
    string[]
  >
  const authEnvVars = authEnvVarsMap[providerId] ?? []
  const optionKeys = authChoices
    .map((c) => c.optionKey)
    .filter((k): k is string => typeof k === "string")
  const authMethods = authChoices
    .map((c) => c.method)
    .filter((m): m is string => typeof m === "string")
  const configSchema = (manifest.configSchema ??
    {}) as Record<string, unknown>
  const uiHints = (manifest.uiHints ?? {}) as Record<
    string,
    unknown
  >
  const configFields: Array<Record<string, unknown>> = []
  flattenConfigSchemaFields(
    null,
    configSchema,
    uiHints,
    configFields,
  )

  const displayName =
    authChoices.find((c) => c.groupLabel)?.groupLabel ??
    authChoices.find((c) => c.choiceLabel)?.choiceLabel ??
    titleCaseProviderId(providerId)

  return {
    id: providerId,
    pluginId,
    displayName,
    category: onboardingProviderCategory(providerId),
    authEnvVars,
    authMethods,
    optionKeys,
    authChoices,
    configFieldCount: configFields.length,
    configFields,
    schema: configSchema,
    uiHints,
    submit: providerSubmitSchemaFromManifest(
      manifest,
      providerId,
    ),
  }
}

export function onboardingModelOptionsForProvider(
  providerId: string,
  authMethod?: string | null,
): Array<Record<string, unknown>> {
  const refMap: Record<string, string[]> = {
    openai: [
      "openai/gpt-5.4",
      "openai/gpt-5.4-mini",
      "openai/o4-mini",
    ],
    "openai-codex": [
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.4-pro",
    ],
    anthropic:
      authMethod === "cli"
        ? [
            "claude-cli/claude-sonnet-4-6",
            "claude-cli/claude-opus-4-6",
            "claude-cli/claude-haiku-4-5",
          ]
        : [
            "anthropic/claude-sonnet-4-6",
            "anthropic/claude-opus-4-6",
            "anthropic/claude-haiku-4-5",
          ],
    google: [
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
    ],
    openrouter: [
      "openrouter/openai/gpt-4o-mini",
      "openrouter/anthropic/claude-sonnet-4-5",
    ],
    deepseek: [
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner",
    ],
    mistral: [
      "mistral/mistral-medium-2505",
      "mistral/mistral-small-2503",
    ],
    xai: ["xai/grok-4", "xai/grok-3-mini"],
    qwen: [
      "qwen/qwen3-coder-plus",
      "qwen/qwen3-235b-a22b",
    ],
    moonshot: ["moonshot/kimi-k2", "moonshot/kimi-latest"],
    ollama: ["ollama/qwen3:4b", "ollama/llama3.2:3b"],
    lmstudio: [
      "lmstudio/local-model",
      "lmstudio/qwen2.5-coder",
    ],
    "github-copilot": [
      "github-copilot/gpt-4.1",
      "github-copilot/claude-sonnet-4-5",
    ],
    codex: ["codex/gpt-5.4", "codex/gpt-5.4-mini"],
  }

  const refs = refMap[providerId] ?? []
  return refs.map((modelRef) => ({
    id: modelRef,
    value: modelRef,
    label: modelRef.split("/").pop() ?? modelRef,
  }))
}

function defaultOnboardingModelRef(
  providerId: string,
  authMethod?: string | null,
): string | null {
  const options = onboardingModelOptionsForProvider(
    providerId,
    authMethod,
  )
  return (options[0]?.value as string) ?? null
}

function selectedOnboardingProvider(): {
  providerId: string
  authMethod: string | null
} | null {
  const db = getDb()
  const providerId = getAppSetting(
    db,
    APP_SETTING_ONBOARDING_PROVIDER_ID,
  )
  if (!providerId) return null
  const authMethod = getAppSetting(
    db,
    APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD,
  )
  return {
    providerId,
    authMethod:
      authMethod && authMethod.trim() ? authMethod : null,
  }
}

function onboardingModelContractValue(
  providerId: string,
  authMethod: string | null,
): Record<string, unknown> {
  const manifest = manifestForProvider(providerId)
  const provider = providerSummaryFromManifest(
    manifest,
    providerId,
  )
  const db = getDb()
  const selectedModelRef = getAppSetting(
    db,
    APP_SETTING_ONBOARDING_MODEL_REF,
  )
  const recommendedModelRef = defaultOnboardingModelRef(
    providerId,
    authMethod,
  )
  const modelOptions = onboardingModelOptionsForProvider(
    providerId,
    authMethod,
  )

  return {
    providerId,
    authMethod,
    selectedModelRef: selectedModelRef ?? null,
    recommendedModelRef,
    submitEndpoint: "middleware_onboarding_model_submit",
    nextStep: "complete",
    provider,
    types: {
      providerId: provider.id,
      submitEndpoint: "middleware_onboarding_model_submit",
      typeNames: {
        payload: providerTypeName(
          (provider.id as string) ?? "model",
          "OnboardingModelSubmitPayload",
        ),
        selection: providerTypeName(
          (provider.id as string) ?? "model",
          "OnboardingModelSelection",
        ),
      },
      payloadShape: {
        providerId: {
          type: "literal",
          value: provider.id ?? null,
        },
        modelRef: {
          type: "string",
          required: true,
          inputKind:
            modelOptions.length === 0 ? "text" : "combobox",
          allowCustom: true,
          recommended: recommendedModelRef,
          options: modelOptions,
        },
        setDefault: { type: "boolean", default: true },
      },
    },
  }
}

function onboardingRecommendation(
  nodeInstalled: boolean,
  npmInstalled: boolean,
  openclawInstalled: boolean,
  gatewayRunning: boolean,
): string {
  if (!nodeInstalled) return "install_node"
  if (!npmInstalled) return "install_npm"
  if (!openclawInstalled) return "install_openclaw"
  if (!gatewayRunning) return "start_gateway"
  return "ready"
}

function onboardingSnapshot(gatewayUrl: string): Record<string, unknown> {
  const nodeVersion = commandVersion("node", "--version")
  const npmVersion = commandVersion("npm", "--version")
  const openclawVersion = commandVersion(
    "openclaw",
    "--version",
  )
  // Gateway check: try a simple HTTP fetch to see if something is listening
  let gatewayIsRunning = false
  try {
    const httpUrl = gatewayUrl
      .replace("ws://", "http://")
      .replace("wss://", "https://")
    execFileSync("curl", ["-sf", "--max-time", "2", httpUrl], {
      timeout: 3000,
    })
    gatewayIsRunning = true
  } catch {
    gatewayIsRunning = false
  }

  return {
    node: {
      installed: nodeVersion !== null,
      version: nodeVersion,
    },
    npm: {
      installed: npmVersion !== null,
      version: npmVersion,
    },
    openclaw: {
      installed: openclawVersion !== null,
      version: openclawVersion,
      installMethod: "npm i -g openclaw",
    },
    gateway: {
      url: gatewayUrl,
      running: gatewayIsRunning,
      status: gatewayIsRunning ? "running" : "stopped",
    },
    recommendation: onboardingRecommendation(
      nodeVersion !== null,
      npmVersion !== null,
      openclawVersion !== null,
      gatewayIsRunning,
    ),
  }
}

function onboardingStepState(
  coreStatus: Record<string, unknown>,
  botName: string | null,
  providerDone: boolean,
  modelDone: boolean,
): Record<string, unknown> {
  const coreDone =
    (coreStatus.recommendation as string) === "ready"
  const botDone = !!botName && botName.trim().length > 0
  let nextStep: string
  if (!coreDone) nextStep = "core"
  else if (!botDone) nextStep = "bot"
  else if (!providerDone) nextStep = "provider"
  else if (!modelDone) nextStep = "model"
  else nextStep = "complete"

  return {
    steps: [
      {
        id: "core",
        title: "Install and start OpenClaw",
        complete: coreDone,
      },
      { id: "bot", title: "Set bot name", complete: botDone },
      {
        id: "provider",
        title: "Choose provider",
        complete: providerDone,
      },
      {
        id: "model",
        title: "Choose default model",
        complete: modelDone,
      },
    ],
    nextStep,
    completed: nextStep === "complete",
  }
}

// ===================== Existing simple commands =====================

export function onboardingStatus() {
  const db = getDb()
  const step =
    getAppSetting(db, "onboarding.step") ?? "not_started"
  const completedAt = getAppSetting(
    db,
    "onboarding.completed_at",
  )
  return { step, completedAt, isComplete: step === "complete" }
}

export function onboardingSetStep(input: { step: string }) {
  const db = getDb()
  setAppSetting(db, "onboarding.step", input.step)
  return { step: input.step }
}

export function onboardingComplete() {
  const db = getDb()
  const now = new Date().toISOString()
  setAppSetting(db, "onboarding.step", "complete")
  setAppSetting(db, "onboarding.completed_at", now)
  return { isComplete: true, completedAt: now }
}

export function onboardingReset() {
  const db = getDb()
  setAppSetting(db, "onboarding.step", "not_started")
  return { step: "not_started" }
}

export function onboardingCheckGateway() {
  const config = readOpenclawConfig()
  const gatewayUrl = config.gateway_url as string | undefined
  return {
    hasConfig: !!gatewayUrl,
    gatewayUrl: gatewayUrl ?? null,
    configPath: openclawConfigPath(),
  }
}

export function onboardingCheckIdentity() {
  const identityPath = path.join(
    os.homedir(),
    ".openclaw",
    "state",
    "identity",
    "device.json",
  )
  const exists = fs.existsSync(identityPath)
  let deviceId = null
  if (exists) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(identityPath, "utf-8"),
      )
      deviceId = raw.device_id ?? null
    } catch {}
  }
  return { hasIdentity: exists, deviceId, identityPath }
}

export function onboardingCheckWorkspace() {
  const workspacePath = path.join(
    os.homedir(),
    ".openclaw",
    "workspace",
  )
  const exists = fs.existsSync(workspacePath)
  return { hasWorkspace: exists, workspacePath }
}

export function onboardingValidateGatewayUrl(input: {
  url: string
}) {
  const url = input.url.trim()
  if (!url) throw new Error("URL cannot be empty")
  const valid =
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("ws://") ||
    url.startsWith("wss://")
  return {
    valid,
    url,
    reason: valid
      ? null
      : "URL must start with http://, https://, ws://, or wss://",
  }
}

export function onboardingCreateWorkspace() {
  const workspacePath = path.join(
    os.homedir(),
    ".openclaw",
    "workspace",
  )
  fs.mkdirSync(workspacePath, { recursive: true })
  fs.mkdirSync(path.join(workspacePath, "memory"), {
    recursive: true,
  })
  return { created: true, workspacePath }
}

export function onboardingCheckDependencies() {
  const deps: Array<{
    name: string
    installed: boolean
    version: string | null
  }> = []
  for (const cmd of ["git", "node", "npm"]) {
    const version = commandVersion(cmd, "--version")
    deps.push({
      name: cmd,
      installed: version !== null,
      version,
    })
  }
  return {
    dependencies: deps,
    allInstalled: deps.every((d) => d.installed),
  }
}

export function onboardingSaveGatewayConfig(input: {
  gatewayUrl: string
}) {
  const configPath = openclawConfigPath()
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })
  const existing = readOpenclawConfig()
  existing.gateway_url = input.gatewayUrl
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2))
  return { saved: true, configPath }
}

export function onboardingGenerateIdentity() {
  const identityDir = path.join(
    os.homedir(),
    ".openclaw",
    "state",
    "identity",
  )
  fs.mkdirSync(identityDir, { recursive: true })
  const identityPath = path.join(identityDir, "device.json")
  if (fs.existsSync(identityPath)) {
    return {
      created: false,
      identityPath,
      reason: "Identity already exists",
    }
  }
  const deviceId = `device_${crypto.randomUUID().replace(/-/g, "")}`
  fs.writeFileSync(
    identityPath,
    JSON.stringify(
      {
        device_id: deviceId,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  return { created: true, identityPath, deviceId }
}

// ===================== Ported Rust commands =====================

export function onboardingCore(input: {
  action?: string
  gatewayUrl?: string
}) {
  const gatewayUrl =
    input.gatewayUrl ??
    `ws://127.0.0.1:${DEFAULT_GATEWAY_PORT}`
  const action = input.action ?? "check"
  const actionsRun: string[] = []

  if (action === "apply") {
    const before = onboardingSnapshot(gatewayUrl)
    const nodeInstalled =
      (before.node as Record<string, unknown>)?.installed === true
    const npmInstalled =
      (before.npm as Record<string, unknown>)?.installed === true
    const openclawInstalled =
      (before.openclaw as Record<string, unknown>)?.installed === true
    const gatewayIsRunning =
      (before.gateway as Record<string, unknown>)?.running === true

    if (!nodeInstalled) {
      return {
        action,
        applied: false,
        canAutoFix: false,
        message:
          "Node.js is not installed. Install Node.js first, then rerun onboarding.",
        manualAction: "install_node",
        docsUrl: "https://nodejs.org/en/download",
        status: before,
        actionsRun,
      }
    }

    if (!npmInstalled) {
      return {
        action,
        applied: false,
        canAutoFix: false,
        message:
          "npm is not installed. Install npm first, then rerun onboarding.",
        manualAction: "install_npm",
        docsUrl:
          "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm",
        status: before,
        actionsRun,
      }
    }

    if (!openclawInstalled) {
      try {
        execFileSync("npm", ["i", "-g", "openclaw"], {
          timeout: 60000,
        })
        actionsRun.push("npm i -g openclaw")
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : String(e)
        throw new Error(
          `OpenClaw npm install failed: ${msg}`,
        )
      }
    }

    if (!gatewayIsRunning) {
      try {
        execFileSync(
          "openclaw",
          ["gateway", "start"],
          { timeout: 15000 },
        )
        actionsRun.push("openclaw gateway start")
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : String(e)
        throw new Error(
          `OpenClaw gateway start failed: ${msg}`,
        )
      }
    }
  }

  const status = onboardingSnapshot(gatewayUrl)
  const recommendation =
    (status.recommendation as string) ?? "install_node"

  return {
    action,
    applied: action === "apply" && actionsRun.length > 0,
    canAutoFix:
      recommendation === "install_openclaw" ||
      recommendation === "start_gateway" ||
      recommendation === "ready",
    status,
    actionsRun,
  }
}

export function onboardingProviders() {
  const manifests = readOpenclawProviderManifests()
  const providers: Array<Record<string, unknown>> = []
  for (const manifest of manifests) {
    const providerIds =
      (manifest.providers as string[]) ?? []
    for (const providerId of providerIds) {
      providers.push(
        providerSummaryFromManifest(manifest, providerId),
      )
    }
  }
  providers.sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? "")),
  )
  return { providers, count: providers.length }
}

export function onboardingProviderTypes() {
  const manifests = readOpenclawProviderManifests()
  const providers: Array<Record<string, unknown>> = []
  for (const manifest of manifests) {
    const providerIds =
      (manifest.providers as string[]) ?? []
    for (const providerId of providerIds) {
      providers.push({
        providerId,
        displayName: providerSummaryFromManifest(
          manifest,
          providerId,
        ).displayName,
        types: providerSubmitSchemaFromManifest(
          manifest,
          providerId,
        ),
      })
    }
  }
  providers.sort((a, b) =>
    String(a.providerId ?? "").localeCompare(
      String(b.providerId ?? ""),
    ),
  )
  return {
    version: "2026-04-18",
    submitEndpoint: "middleware_onboarding_provider_submit",
    providers,
  }
}

export function onboardingProviderDetails(input: {
  providerId: string
}) {
  const manifest = manifestForProvider(input.providerId)
  return {
    provider: providerSummaryFromManifest(
      manifest,
      input.providerId,
    ),
  }
}

export function onboardingProviderSubmit(input: {
  providerId: string
  authMethod?: string
  values?: Record<string, unknown>
  setDefault?: boolean
}) {
  const manifest = manifestForProvider(input.providerId)
  const provider = providerSummaryFromManifest(
    manifest,
    input.providerId,
  )
  const submitSchema = providerSubmitSchemaFromManifest(
    manifest,
    input.providerId,
  )
  const authMethods = (
    (provider.authMethods as string[]) ?? []
  ).slice()
  let authMethod = input.authMethod ?? undefined
  if (!authMethod && authMethods.length === 1) {
    authMethod = authMethods[0]
  }
  if (authMethods.length > 1 && !authMethod) {
    throw new Error(
      `Provider ${input.providerId} requires authMethod. Supported values: ${authMethods.join(", ")}`,
    )
  }
  if (
    authMethod &&
    authMethods.length > 0 &&
    !authMethods.includes(authMethod)
  ) {
    throw new Error(
      `Unsupported authMethod '${authMethod}' for provider ${input.providerId}`,
    )
  }

  const values = input.values ?? {}
  const payloadShape = submitSchema.payloadShape as Record<
    string,
    unknown
  >
  const valuesShape = payloadShape?.values as Record<
    string,
    unknown
  >
  const fieldsShape = valuesShape?.fields as Record<
    string,
    unknown
  >
  const credentialFields = (
    (fieldsShape?.credentials as Array<
      Record<string, unknown>
    >) ?? []
  ).slice()
  const configFields = (
    (fieldsShape?.config as Array<
      Record<string, unknown>
    >) ?? []
  ).slice()

  for (const field of credentialFields) {
    const fieldAuthMethod = field.authMethod as
      | string
      | undefined
    if (
      authMethod &&
      fieldAuthMethod &&
      fieldAuthMethod !== authMethod
    )
      continue
    const key = (field.key as string) ?? ""
    const required =
      (field.required as boolean | undefined) ?? false
    const isPresent =
      typeof values[key] === "string" &&
      (values[key] as string).trim().length > 0
    if (required && !isPresent) {
      throw new Error(
        `Missing required credential field: ${key}`,
      )
    }
  }

  for (const field of configFields) {
    const key = (field.key as string) ?? ""
    const required =
      (field.required as boolean | undefined) ?? false
    if (required && !(key in values)) {
      throw new Error(
        `Missing required config field: ${key}`,
      )
    }
  }

  const config = readOpenclawConfigValue()
  const savedEnvVars: string[] = []
  const savedConfigPaths: string[] = []

  for (const field of credentialFields) {
    const fieldAuthMethod = field.authMethod as
      | string
      | undefined
    if (
      authMethod &&
      fieldAuthMethod &&
      fieldAuthMethod !== authMethod
    )
      continue
    const key = (field.key as string) ?? ""
    const val = values[key]
    if (typeof val === "string" && val.trim().length > 0) {
      const envVar = field.envVar as string | undefined
      if (envVar) {
        setJsonPath(config, `env.vars.${envVar}`, val)
        savedEnvVars.push(envVar)
      }
    }
  }

  const pluginId = (provider.pluginId as string) ?? ""
  let pluginConfig = (valueAtJsonPath(config, pluginId) ??
    {}) as Record<string, unknown>
  if (typeof pluginConfig !== "object" || pluginConfig === null) {
    pluginConfig = {}
  }

  for (const field of configFields) {
    const key = (field.key as string) ?? ""
    const sourcePath =
      (field.sourcePath as string) ?? key
    if (key in values) {
      setJsonPath(pluginConfig, sourcePath, values[key])
      savedConfigPaths.push(`${pluginId}.${sourcePath}`)
    }
  }

  if (savedConfigPaths.length > 0) {
    setJsonPath(config, pluginId, pluginConfig)
  }

  writeOpenclawConfigValue(config)

  const db = getDb()
  setAppSetting(
    db,
    APP_SETTING_ONBOARDING_PROVIDER_ID,
    input.providerId,
  )
  setAppSetting(
    db,
    APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD,
    authMethod ?? "",
  )

  const persistedValues: Record<string, unknown> = {}
  const allFields = [...credentialFields, ...configFields]
  for (const [key, value] of Object.entries(values)) {
    const isSensitive = allFields.some(
      (f) =>
        (f.key as string) === key &&
        (f.sensitive as boolean) === true,
    )
    if (!isSensitive) {
      persistedValues[key] = value
    }
  }
  setAppSetting(
    db,
    `${APP_SETTING_ONBOARDING_PROVIDER_VALUES_PREFIX}${input.providerId}`,
    JSON.stringify(persistedValues),
  )

  return {
    ok: true,
    providerId: input.providerId,
    authMethod: authMethod ?? null,
    saved: {
      envVars: savedEnvVars,
      configPaths: savedConfigPaths,
      setDefault: input.setDefault ?? true,
    },
    nextStep: "model-selection",
    openClawFlow: ["onboarding", "model-selection"],
    provider,
    types: submitSchema,
  }
}

export function onboardingModelContract(input?: {
  providerId?: string
}) {
  let providerId: string
  let authMethod: string | null

  if (input?.providerId) {
    providerId = input.providerId
    const db = getDb()
    const rawAuth = getAppSetting(
      db,
      APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD,
    )
    authMethod =
      rawAuth && rawAuth.trim() ? rawAuth : null
  } else {
    const selected = selectedOnboardingProvider()
    if (!selected)
      throw new Error(
        "No onboarding provider selected yet",
      )
    providerId = selected.providerId
    authMethod = selected.authMethod
  }

  const contract = onboardingModelContractValue(
    providerId,
    authMethod,
  )
  return { contract }
}

export function onboardingModelSubmit(input: {
  providerId?: string
  modelRef: string
  setDefault?: boolean
}) {
  let providerId: string
  let authMethod: string | null

  if (input.providerId) {
    providerId = input.providerId
    const db = getDb()
    const rawAuth = getAppSetting(
      db,
      APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD,
    )
    authMethod =
      rawAuth && rawAuth.trim() ? rawAuth : null
  } else {
    const selected = selectedOnboardingProvider()
    if (!selected)
      throw new Error(
        "No onboarding provider selected yet",
      )
    providerId = selected.providerId
    authMethod = selected.authMethod
  }

  const modelRef = input.modelRef.trim()
  if (!modelRef) throw new Error("modelRef is required")
  if (modelRef.includes(".."))
    throw new Error("Invalid model reference")
  if (!modelRef.includes("/"))
    throw new Error(
      "modelRef must use provider/model format",
    )
  if (!modelRef.startsWith(`${providerId}/`))
    throw new Error(
      `modelRef '${modelRef}' does not belong to selected provider ${providerId}`,
    )

  const config = readOpenclawConfigValue()
  setJsonPath(
    config,
    "agents.defaults.model.primary",
    modelRef,
  )
  writeOpenclawConfigValue(config)

  const db = getDb()
  setAppSetting(db, APP_SETTING_ONBOARDING_MODEL_REF, modelRef)
  setAppSetting(
    db,
    APP_SETTING_ONBOARDING_MODEL_PROVIDER_ID,
    providerId,
  )

  const contract = onboardingModelContractValue(
    providerId,
    authMethod,
  )
  return {
    ok: true,
    providerId,
    modelRef,
    saved: {
      setDefault: input.setDefault ?? true,
      configPaths: ["agents.defaults.model.primary"],
    },
    nextStep: "complete",
    openClawFlow: ["onboarding", "complete"],
    contract,
  }
}

export function onboardingFlow(input?: {
  action?: string
  gatewayUrl?: string
}) {
  const gatewayUrl =
    input?.gatewayUrl ??
    `ws://127.0.0.1:${DEFAULT_GATEWAY_PORT}`
  const coreStatus = onboardingSnapshot(gatewayUrl)
  const db = getDb()
  const botName = getAppSetting(
    db,
    APP_SETTING_OPENCLAW_BOT_NAME,
  )
  const selectedProvider = selectedOnboardingProvider()
  const config = readOpenclawConfigValue()
  const selectedModelRef =
    getAppSetting(db, APP_SETTING_ONBOARDING_MODEL_REF) ??
    ((
      valueAtJsonPath(
        config,
        "agents.defaults.model.primary",
      ) as string
    ) || null)

  const providerDetails = selectedProvider
    ? {
        providerId: selectedProvider.providerId,
        authMethod: selectedProvider.authMethod,
      }
    : null
  let modelContract: Record<string, unknown> | null = null
  if (selectedProvider) {
    try {
      modelContract = onboardingModelContractValue(
        selectedProvider.providerId,
        selectedProvider.authMethod,
      )
    } catch {
      modelContract = null
    }
  }
  const flow = onboardingStepState(
    coreStatus,
    botName ?? null,
    selectedProvider !== null,
    selectedModelRef !== null,
  )

  return {
    flow,
    state: {
      core: {
        status: coreStatus,
        checkEndpoint: "middleware_onboarding_core",
      },
      bot: {
        botName: botName ?? null,
        getEndpoint: "middleware_openclaw_bot_name_get",
        setEndpoint: "middleware_openclaw_bot_name_set",
      },
      provider: {
        selection: providerDetails,
        listEndpoint: "middleware_onboarding_providers",
        typesEndpoint: "middleware_onboarding_provider_types",
        detailsEndpoint:
          "middleware_onboarding_provider_details",
        submitEndpoint:
          "middleware_onboarding_provider_submit",
      },
      model: {
        selectedModelRef,
        contractEndpoint:
          "middleware_onboarding_model_contract",
        submitEndpoint:
          "middleware_onboarding_model_submit",
        contract: modelContract,
      },
    },
  }
}

export function onboardingSignOut() {
  const db = getDb()
  db.prepare(
    "DELETE FROM app_settings WHERE key LIKE 'onboarding.%' OR key = ?",
  ).run(APP_SETTING_OPENCLAW_BOT_NAME)
  return {
    ok: true,
    cleared: ["onboarding.*", "openclaw.bot_name"],
  }
}

export function onboardingDeleteAccount() {
  const db = getDb()
  db.prepare("DELETE FROM app_settings").run()

  const configPath = openclawConfigPath()
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(content) as Record<
        string,
        unknown
      >
      const env = config.env as
        | Record<string, unknown>
        | undefined
      if (env?.vars && typeof env.vars === "object") {
        const vars = env.vars as Record<string, unknown>
        for (const key of Object.keys(vars)) {
          delete vars[key]
        }
      }
      const agents = config.agents as
        | Record<string, unknown>
        | undefined
      const defaults = agents?.defaults as
        | Record<string, unknown>
        | undefined
      const model = defaults?.model as
        | Record<string, unknown>
        | undefined
      if (model) {
        delete model.primary
      }
      fs.writeFileSync(
        configPath,
        JSON.stringify(config, null, 2),
      )
    } catch {}
  }

  return {
    ok: true,
    cleared: [
      "app_settings",
      "env.vars",
      "agents.defaults.model.primary",
    ],
  }
}
