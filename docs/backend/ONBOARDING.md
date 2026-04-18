# Jarvis Desktop Onboarding Backend Contract

This is the single source of truth for the end-to-end onboarding flow exposed by the desktop Tauri middleware.

Backend files:
- `packages/desktop/src-tauri/src/middleware.rs`
- `packages/desktop/src-tauri/src/lib.rs`

## Commands

Core setup:
- `middleware_onboarding_core`

Bot setup:
- `middleware_openclaw_bot_name_get`
- `middleware_openclaw_bot_name_set`

Provider setup:
- `middleware_onboarding_providers`
- `middleware_onboarding_provider_types`
- `middleware_onboarding_provider_details`
- `middleware_onboarding_provider_submit`

Model setup:
- `middleware_onboarding_model_contract`
- `middleware_onboarding_model_submit`

Unified flow:
- `middleware_onboarding_flow`

Compatibility helpers still available:
- `middleware_openclaw_check`
- `middleware_openclaw_install`

## Recommended frontend order

1. Call `middleware_onboarding_flow` on screen load.
2. If `flow.nextStep === "core"`, use `middleware_onboarding_core`.
3. If `flow.nextStep === "bot"`, use bot-name get/set endpoints.
4. If `flow.nextStep === "provider"`, load provider picker and submit provider.
5. If `flow.nextStep === "model"`, fetch model contract and submit model.
6. If `flow.nextStep === "complete"`, onboarding is done.

## 1. Unified flow endpoint

### `middleware_onboarding_flow`

Input:
```json
{
  "action": "check",
  "gatewayUrl": "ws://127.0.0.1:18789"
}
```

Both fields are optional. `gatewayUrl` defaults to local gateway.

Response:
```json
{
  "flow": {
    "steps": [
      { "id": "core", "title": "Install and start OpenClaw", "complete": true },
      { "id": "bot", "title": "Set bot name", "complete": true },
      { "id": "provider", "title": "Choose provider", "complete": true },
      { "id": "model", "title": "Choose default model", "complete": false }
    ],
    "nextStep": "model",
    "completed": false
  },
  "state": {
    "core": {
      "status": {
        "node": { "installed": true, "version": "v22.22.0" },
        "npm": { "installed": true, "version": "10.9.3" },
        "openclaw": {
          "installed": true,
          "version": "openclaw 0.x.x",
          "installMethod": "npm i -g openclaw"
        },
        "gateway": {
          "url": "ws://127.0.0.1:18789",
          "running": true,
          "status": "running"
        },
        "recommendation": "ready"
      },
      "checkEndpoint": "middleware_onboarding_core"
    },
    "bot": {
      "botName": "Jarvis",
      "getEndpoint": "middleware_openclaw_bot_name_get",
      "setEndpoint": "middleware_openclaw_bot_name_set"
    },
    "provider": {
      "selection": {
        "providerId": "openai",
        "authMethod": "api-key"
      },
      "listEndpoint": "middleware_onboarding_providers",
      "typesEndpoint": "middleware_onboarding_provider_types",
      "detailsEndpoint": "middleware_onboarding_provider_details",
      "submitEndpoint": "middleware_onboarding_provider_submit"
    },
    "model": {
      "selectedModelRef": null,
      "contractEndpoint": "middleware_onboarding_model_contract",
      "submitEndpoint": "middleware_onboarding_model_submit",
      "contract": {
        "providerId": "openai",
        "recommendedModelRef": "openai/gpt-5.4"
      }
    }
  }
}
```

Meaning:
- `flow.steps` is the ordered progress UI contract.
- `flow.nextStep` is the exact screen the frontend should route to next.
- `flow.completed` means onboarding is fully complete.
- `state` contains the current saved state plus endpoint hints for each step.

## 2. Core setup

### `middleware_onboarding_core`

Input:
```json
{
  "action": "check",
  "gatewayUrl": "ws://127.0.0.1:18789"
}
```

`action`:
- `check`: read-only status
- `apply`: auto-fix what backend safely can

Checks, in order:
1. Node.js
2. npm
3. OpenClaw CLI
4. OpenClaw Gateway

Recommendation values:
- `install_node`
- `install_npm`
- `install_openclaw`
- `start_gateway`
- `ready`

`apply` behavior:
- installs OpenClaw with `npm i -g openclaw` when possible
- starts gateway with `openclaw gateway start` when possible
- returns updated status snapshot

Example response:
```json
{
  "action": "apply",
  "applied": true,
  "canAutoFix": true,
  "status": {
    "recommendation": "ready"
  },
  "actionsRun": ["npm i -g openclaw", "openclaw gateway start"]
}
```

If Node or npm is missing, backend returns manual-action guidance instead of trying to install them.

## 3. Bot setup

### `middleware_openclaw_bot_name_get`

Input: none.

Response:
```json
{
  "botName": "Jarvis"
}
```

### `middleware_openclaw_bot_name_set`

Input:
```json
{
  "botName": "Jarvis"
}
```

Response:
```json
{
  "ok": true,
  "botName": "Jarvis"
}
```

Persistence:
- SQLite app setting: `openclaw.bot_name`

Frontend rule:
- bot step is complete when `botName` is non-empty.

## 4. Provider catalog and typed setup

Use these after core is ready.

### `middleware_onboarding_providers`
Returns the normalized provider catalog for the picker.

Example:
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
      "submit": { "submitEndpoint": "middleware_onboarding_provider_submit" }
    }
  ],
  "count": 52
}
```

### `middleware_onboarding_provider_types`
Returns frontend-oriented typed form contracts for all providers.

Important fields:
- `stepKind`: `api-key`, `mixed`, `local`, or `advanced`
- `typeNames`: suggested generated type names
- `payloadShape`: exact payload contract to submit
- `values.fields.credentials`: auth fields
- `values.fields.config`: config fields derived from manifest schema

### `middleware_onboarding_provider_details`
Input:
```json
{ "providerId": "openai" }
```

Returns the full provider contract for one provider, including raw schema-derived config fields and submit schema.

### `middleware_onboarding_provider_submit`
Input:
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

What it does:
- validates provider and auth method
- validates required credential/config fields
- stores onboarding selection in SQLite
- writes env vars to `~/.openclaw/openclaw.json` under `env.vars`
- writes provider config into the provider block in `~/.openclaw/openclaw.json`

Persistence keys:
- `onboarding.provider.id`
- `onboarding.provider.auth_method`
- `onboarding.provider.values.*`

Response:
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
  "provider": { "id": "openai" },
  "types": {
    "submitEndpoint": "middleware_onboarding_provider_submit"
  }
}
```

## 5. Model selection

Use this after provider submission.

### `middleware_onboarding_model_contract`
Input:
```json
{
  "providerId": "openai"
}
```

`providerId` is optional. If omitted, backend uses the saved onboarding provider.

Response:
```json
{
  "contract": {
    "providerId": "openai",
    "authMethod": "api-key",
    "selectedModelRef": null,
    "recommendedModelRef": "openai/gpt-5.4",
    "submitEndpoint": "middleware_onboarding_model_submit",
    "nextStep": "complete",
    "provider": {
      "id": "openai",
      "displayName": "OpenAI"
    },
    "types": {
      "providerId": "openai",
      "submitEndpoint": "middleware_onboarding_model_submit",
      "typeNames": {
        "payload": "OpenaiOnboardingModelSubmitPayload",
        "selection": "OpenaiOnboardingModelSelection"
      },
      "payloadShape": {
        "providerId": { "type": "literal", "value": "openai" },
        "modelRef": {
          "type": "string",
          "required": true,
          "inputKind": "combobox",
          "allowCustom": true,
          "recommended": "openai/gpt-5.4",
          "options": [
            { "id": "openai/gpt-5.4", "value": "openai/gpt-5.4", "label": "gpt-5.4" }
          ]
        },
        "setDefault": { "type": "boolean", "default": true }
      }
    }
  }
}
```

Frontend rules:
- render the model field from `types.payloadShape.modelRef`
- use `options` for suggested choices
- allow manual entry because some providers support more models than the suggested shortlist
- always submit full `provider/model` ref format

### `middleware_onboarding_model_submit`
Input:
```json
{
  "providerId": "openai",
  "modelRef": "openai/gpt-5.4",
  "setDefault": true
}
```

`providerId` is optional if a provider is already saved.

Validation:
- `modelRef` is required
- `modelRef` must contain `/`
- `modelRef` must match the selected provider prefix

What it does:
- writes `agents.defaults.model.primary` in `~/.openclaw/openclaw.json`
- stores onboarding model selection in SQLite

Persistence keys:
- `onboarding.model.ref`
- `onboarding.model.provider_id`

Response:
```json
{
  "ok": true,
  "providerId": "openai",
  "modelRef": "openai/gpt-5.4",
  "saved": {
    "setDefault": true,
    "configPaths": ["agents.defaults.model.primary"]
  },
  "nextStep": "complete",
  "openClawFlow": ["onboarding", "complete"],
  "contract": {
    "providerId": "openai",
    "selectedModelRef": "openai/gpt-5.4"
  }
}
```

## 6. Completion rules

The backend treats onboarding as complete when all of these are true:
- core recommendation is `ready`
- bot name is set
- provider selection is saved
- model selection is saved

`middleware_onboarding_flow` computes this and exposes:
- ordered `steps`
- `nextStep`
- `completed`

## 7. Simple frontend implementation sketch

```ts
const flow = await invoke("middleware_onboarding_flow", {})

switch (flow.flow.nextStep) {
  case "core":
    await invoke("middleware_onboarding_core", { action: "check" })
    break
  case "bot":
    await invoke("middleware_openclaw_bot_name_get")
    break
  case "provider":
    await invoke("middleware_onboarding_provider_types")
    break
  case "model":
    await invoke("middleware_onboarding_model_contract", {})
    break
  case "complete":
    // continue into app
    break
}
```

## 8. Error cases to handle

Examples:
- `Unsupported OpenClaw provider: definitely-not-real`
- `Provider anthropic requires authMethod. Supported values: api-key, cli`
- `Missing required credential field: openaiApiKey`
- `No onboarding provider selected yet`
- `modelRef is required`
- `modelRef must use provider/model format`
- `modelRef 'anthropic/claude-sonnet-4-6' does not belong to selected provider openai`

## 9. Compatibility notes

Older helpers remain for compatibility only:
- `middleware_openclaw_check`
- `middleware_openclaw_install`

Prefer the onboarding endpoints above for all new frontend work.
