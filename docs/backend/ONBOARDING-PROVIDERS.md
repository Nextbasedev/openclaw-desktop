# ONBOARDING-PROVIDERS.md

Purpose: frontend-facing contract for provider selection, provider form generation, and provider submission during onboarding.

These endpoints read the real bundled OpenClaw extension manifests from this repo and expose them in a frontend-friendly shape.

Current commands:
- `middleware_onboarding_providers`
- `middleware_onboarding_provider_types`
- `middleware_onboarding_provider_details`
- `middleware_onboarding_provider_submit`

Use them after core onboarding is `ready`.

---

## 1. `middleware_onboarding_providers`

Returns the full bundled provider catalog.

### Input
No input.

### Response
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
      "authChoices": [...],
      "configFieldCount": 1,
      "configFields": [...],
      "schema": {...},
      "uiHints": {...},
      "submit": {...}
    }
  ],
  "count": 52
}
```

### Notes
- `category` is a Jarvis UI hint, not raw OpenClaw metadata.
- `submit` is the normalized submit/type contract for that provider.

Use this to build the provider picker.

---

## 2. `middleware_onboarding_provider_types`

Returns frontend-oriented typed schemas for every provider.

This is the easiest endpoint for frontend form generation.

### Input
No input.

### Response
```json
{
  "version": "2026-04-18",
  "submitEndpoint": "middleware_onboarding_provider_submit",
  "providers": [
    {
      "providerId": "openai",
      "displayName": "OpenAI",
      "types": {
        "providerId": "openai",
        "submitEndpoint": "middleware_onboarding_provider_submit",
        "stepKind": "api-key",
        "typeNames": {
          "payload": "OpenaiOnboardingSubmitPayload",
          "authMethod": "OpenaiAuthMethod",
          "values": "OpenaiOnboardingValues"
        },
        "payloadShape": {
          "providerId": { "type": "literal", "value": "openai" },
          "authMethod": { "type": "enum", "options": ["api-key"] },
          "setDefault": { "type": "boolean", "default": true },
          "values": {
            "type": "object",
            "fields": {
              "credentials": [
                {
                  "key": "openaiApiKey",
                  "label": "OpenAI API key",
                  "group": "credentials",
                  "authMethod": "api-key",
                  "valueType": "string",
                  "inputKind": "secret",
                  "required": true,
                  "sensitive": true,
                  "envVar": "OPENAI_API_KEY"
                }
              ],
              "config": [
                {
                  "key": "personality",
                  "sourcePath": "personality",
                  "group": "config",
                  "valueType": "string",
                  "inputKind": "select",
                  "enum": ["friendly", "on", "off"],
                  "default": "friendly"
                }
              ]
            }
          }
        }
      }
    }
  ]
}
```

### Meaning of key type fields
- `stepKind`
  - `api-key`
  - `mixed`
  - `local`
  - `advanced`
- `typeNames`: suggested frontend-generated interface/type names
- `payloadShape`: exact payload contract frontend should send to submit endpoint
- `credentials`: auth-specific fields
- `config`: provider config fields derived from manifest schema
- `inputKind`: frontend widget hint
  - `secret`
  - `text`
  - `number`
  - `toggle`
  - `select`
  - `action`
  - `group`

---

## 3. `middleware_onboarding_provider_details`

Returns the full detailed contract for one provider.

### Input
```json
{
  "providerId": "openai"
}
```

### Response
```json
{
  "provider": {
    "id": "openai",
    "pluginId": "openai",
    "displayName": "OpenAI",
    "category": "core",
    "authEnvVars": ["OPENAI_API_KEY"],
    "authMethods": ["api-key"],
    "authChoices": [...],
    "configFields": [...],
    "schema": {...},
    "uiHints": {...},
    "submit": {...}
  }
}
```

Use this when user has already chosen a provider and you want the full provider-specific form contract.

---

## 4. `middleware_onboarding_provider_submit`

This is the write/post-style endpoint.

Use it when the user submits provider setup.

### Input
```json
{
  "providerId": "openai",
  "authMethod": "api-key",
  "values": {
    "openaiApiKey": "sk-...",
    "personality": "friendly"
  },
  "setDefault": true
}
```

### What it does
- validates provider ID
- validates auth method when provider has multiple methods
- validates required credential/config fields
- persists selected provider + auth method in Jarvis SQLite app settings
- writes credential env vars into `~/.openclaw/openclaw.json` under `env.vars`
- writes provider config values into the plugin-owned top-level config block in `~/.openclaw/openclaw.json`
- returns the next onboarding step and the typed contract again

### Response
```json
{
  "ok": true,
  "providerId": "openai",
  "authMethod": "api-key",
  "saved": {
    "envVars": ["OPENAI_API_KEY"],
    "configPaths": ["openai.personality"],
    "setDefault": true
  },
  "nextStep": "model-selection",
  "openClawFlow": ["onboarding", "model-selection"],
  "provider": {...},
  "types": {...}
}
```

### Error cases
Examples:
```json
Unsupported OpenClaw provider: openaii
```

```json
Provider anthropic requires authMethod. Supported values: api-key, cli
```

```json
Missing required credential field: openaiApiKey
```

---

## 5. Recommended frontend flow

### Step 1, load providers
```ts
invoke("middleware_onboarding_providers")
```

### Step 2, get typed form contracts
Either:
```ts
invoke("middleware_onboarding_provider_types")
```
for all providers,

or:
```ts
invoke("middleware_onboarding_provider_details", {
  providerId: selectedProviderId,
})
```
for one provider.

### Step 3, render UI from type contract
Build the form from:
- `submit.payloadShape.values.fields.credentials`
- `submit.payloadShape.values.fields.config`

### Step 4, submit
```ts
invoke("middleware_onboarding_provider_submit", {
  providerId: selectedProviderId,
  authMethod,
  values,
  setDefault: true,
})
```

### Step 5, move forward
Use returned:
- `nextStep`
- `openClawFlow`

Current next step is:
- `model-selection`

---

## 6. Product guidance

Do not hardcode provider setup forms in frontend.

Use backend-supplied:
- provider list
- auth methods
- config fields
- sensitivity flags
- input widget hints
- submit payload types

That keeps Jarvis aligned with the actual bundled OpenClaw version.

---

## 7. Related docs

- `docs/backend/ONBOARDING.md`
- `docs/backend/ONBOARDING-FRONTEND.md`
- `docs/backend/RUNTIME-ADMIN.md`
