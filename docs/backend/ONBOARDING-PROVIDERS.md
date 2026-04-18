# ONBOARDING-PROVIDERS.md

Purpose: frontend-facing contract for provider selection during onboarding.

These endpoints expose the real OpenClaw provider catalog from the bundled extension manifests in the Jarvis repo.

Primary commands:
- `middleware_onboarding_providers`
- `middleware_onboarding_provider_details`

Use them after core onboarding is `ready`, when the user needs to:
- pick a provider
- see available auth methods
- render the next provider-specific setup step

---

## 1. `middleware_onboarding_providers`

Returns the full supported OpenClaw provider list as currently bundled in this repo.

### Input
No input.

### Response shape
```json
{
  "providers": [
    {
      "id": "openai",
      "pluginId": "openai",
      "displayName": "OpenAI",
      "category": "core",
      "authEnvVars": ["OPENAI_API_KEY"],
      "authMethods": ["api-key"],
      "optionKeys": ["openaiApiKey"],
      "authChoices": [],
      "configFieldCount": 1,
      "configFields": [],
      "schema": {},
      "uiHints": {}
    }
  ],
  "count": 52
}
```

### Meaning of key fields
- `id`: exact OpenClaw provider ID
- `pluginId`: extension/plugin that owns this provider
- `displayName`: best frontend display label derived from manifest auth choices/group labels
- `category`:
  - `core`
  - `local`
  - `advanced`
- `authEnvVars`: env vars OpenClaw recognizes for this provider
- `authMethods`: auth modes declared by the provider manifest
- `optionKeys`: provider-specific option keys from auth choices
- `configFieldCount`: number of flattened config fields exposed by manifest schema

### Category meaning
This is a Jarvis onboarding hint, not raw OpenClaw metadata.

- `core`: common hosted providers we likely want to show first
- `local`: local/custom/runtime-backed providers like Ollama or LM Studio
- `advanced`: infra/specialized providers requiring more setup or uncommon flows

### Frontend usage
Use this endpoint to:
- render provider picker
- group providers by onboarding category
- show badges like `API key`, `OAuth`, `Local`, `Advanced`
- decide whether next step is simple or complex

---

## 2. `middleware_onboarding_provider_details`

Returns the detailed onboarding contract for a selected provider.

### Input
```json
{
  "providerId": "openai"
}
```

### Response shape
```json
{
  "provider": {
    "id": "openai",
    "pluginId": "openai",
    "displayName": "OpenAI",
    "category": "core",
    "authEnvVars": ["OPENAI_API_KEY"],
    "authMethods": ["api-key"],
    "optionKeys": ["openaiApiKey"],
    "authChoices": [
      {
        "provider": "openai",
        "method": "api-key",
        "choiceId": "openai-api-key",
        "choiceLabel": "OpenAI API key",
        "optionKey": "openaiApiKey"
      }
    ],
    "configFieldCount": 1,
    "configFields": [
      {
        "path": "personality",
        "type": "string",
        "required": false,
        "label": null,
        "help": null,
        "enum": ["friendly", "on", "off"],
        "default": "friendly",
        "sensitive": false
      }
    ],
    "schema": {},
    "uiHints": {}
  }
}
```

### `configFields`
`configFields` is a flattened view of the manifest `configSchema`.

Examples:
- `personality`
- `webSearch.apiKey`
- `codeExecution.enabled`
- `xSearch.timeoutSeconds`

Each field includes:
- `path`: dotted field path
- `type`: schema type or joined union type
- `required`: whether parent schema marked it required
- `label`: optional UI label from `uiHints`
- `help`: optional help text from `uiHints`
- `enum`: allowed enum values when present
- `default`: default value when present
- `sensitive`: whether UI should treat it as secret input

### Error case
If provider is unsupported:
```json
Unsupported OpenClaw provider: provider-id
```

---

## 3. Recommended frontend flow

### Step 1, load provider catalog
Call:
```ts
invoke("middleware_onboarding_providers")
```

Use result to build provider selection UI.

### Step 2, user selects provider
Call:
```ts
invoke("middleware_onboarding_provider_details", {
  providerId: selectedProviderId,
})
```

### Step 3, render provider-specific step
Use returned fields to decide the next form:

#### Simple API-key providers
Examples:
- `openai`
- `anthropic`
- `openrouter`
- `google`
- `deepseek`
- `mistral`

Typical UI:
- provider label
- auth mode label
- secret/API key input
- maybe 0 or 1 optional advanced fields

#### OAuth / local providers
Examples:
- `openai-codex`
- `google-gemini-cli`
- `github-copilot`
- `ollama`
- `lmstudio`
- `vllm`
- `sglang`

Typical UI:
- auth mode chooser or login CTA
- local runtime guidance
- optionally discovery toggles

#### Advanced providers
Examples:
- `amazon-bedrock`
- `anthropic-vertex`
- `microsoft-foundry`
- `comfy`

Typical UI:
- advanced setup form
- infra-specific helper copy
- do not treat them like plain API-key-only providers

---

## 4. Important product guidance

Do not hardcode provider fields in frontend if this endpoint can supply them.

Frontend should use:
- `authMethods`
- `authEnvVars`
- `authChoices`
- `configFields`
- `uiHints`

That keeps Jarvis aligned with the actual bundled OpenClaw version.

---

## 5. Practical examples

### Example: OpenAI
Expected onboarding shape:
- auth method: `api-key`
- env var: `OPENAI_API_KEY`
- optional config field: `personality`

### Example: Google
Expected onboarding shape:
- auth method: `api-key` or OAuth variant via related provider
- env vars: `GEMINI_API_KEY`, `GOOGLE_API_KEY`
- config field: `webSearch.apiKey`, `webSearch.model`

### Example: xAI
Expected onboarding shape:
- auth method: `api-key`
- env var: `XAI_API_KEY`
- extra config fields:
  - `webSearch.*`
  - `xSearch.*`
  - `codeExecution.*`

### Example: Amazon Bedrock
Expected onboarding shape:
- not simple API-key-first
- advanced infra provider
- config fields include discovery and guardrail settings

---

## 6. Related docs

- `docs/backend/ONBOARDING.md`
- `docs/backend/ONBOARDING-FRONTEND.md`
- `docs/backend/RUNTIME-ADMIN.md`
