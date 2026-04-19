# Feature Migration: Onboarding

## Overview

Onboarding guides the user through first-time setup: checking dependencies, configuring the Gateway, generating device identity, setting up providers and models.

## Commands

### Setup Flow

| Command | Args |
|---------|------|
| `middleware_onboarding_flow` | `{ action?, gatewayUrl? }` |
| `middleware_onboarding_core` | `{ action?, gatewayUrl? }` |
| `middleware_onboarding_status` | `{}` |
| `middleware_onboarding_set_step` | `{ step }` |
| `middleware_onboarding_complete` | `{}` |
| `middleware_onboarding_reset` | `{}` |

### Dependency Checks

| Command | Args |
|---------|------|
| `middleware_onboarding_check_dependencies` | `{}` |
| `middleware_onboarding_check_gateway` | `{}` |
| `middleware_onboarding_check_identity` | `{}` |
| `middleware_onboarding_check_workspace` | `{}` |
| `middleware_onboarding_validate_gateway_url` | `{ url }` |

### Setup Actions

| Command | Args |
|---------|------|
| `middleware_onboarding_create_workspace` | `{}` |
| `middleware_onboarding_save_gateway_config` | `{ gatewayUrl }` |
| `middleware_onboarding_generate_identity` | `{}` |

### Provider Configuration

| Command | Args |
|---------|------|
| `middleware_onboarding_providers` | `{}` |
| `middleware_onboarding_provider_types` | `{}` |
| `middleware_onboarding_provider_details` | `{ providerId }` |
| `middleware_onboarding_provider_submit` | `{ providerId, authMethod, fields }` |

### Model Configuration

| Command | Args |
|---------|------|
| `middleware_onboarding_model_contract` | `{ providerId? }` |
| `middleware_onboarding_model_submit` | `{ providerId, modelId, displayName? }` |

### Account

| Command | Args |
|---------|------|
| `middleware_onboarding_sign_out` | `{}` |
| `middleware_onboarding_delete_account` | `{}` |

## Key Responses

### onboardingFlow response

```json
{
  "step": "gateway",
  "steps": {
    "gateway": { "status": "complete", "label": "Gateway" },
    "identity": { "status": "pending", "label": "Identity" },
    "workspace": { "status": "pending", "label": "Workspace" },
    "providers": { "status": "pending", "label": "Providers" },
    "models": { "status": "pending", "label": "Models" }
  },
  "gatewayUrl": "http://localhost:18789",
  "gatewayReachable": true,
  "hasIdentity": true,
  "hasWorkspace": true
}
```

### onboardingProviders response

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "type": "cloud",
      "category": "Cloud AI",
      "description": "Claude models via Anthropic API",
      "website": "https://anthropic.com"
    }
  ]
}
```

### onboardingCheckDependencies response

```json
{
  "deps": [
    { "name": "git", "installed": true, "version": "2.43.0", "required": true },
    { "name": "node", "installed": true, "version": "22.0.0", "required": true },
    { "name": "docker", "installed": false, "version": null, "required": false }
  ]
}
```

## Migration

```typescript
import { invoke } from "@/lib/ipc"

// Get full onboarding flow state
const flow = await invoke("middleware_onboarding_flow", {})

// Check dependencies
const deps = await invoke("middleware_onboarding_check_dependencies")

// Configure gateway
await invoke("middleware_onboarding_save_gateway_config", {
  gatewayUrl: "http://localhost:18789"
})

// List available providers
const { providers } = await invoke("middleware_onboarding_providers")

// Submit provider credentials
await invoke("middleware_onboarding_provider_submit", {
  providerId: "anthropic",
  authMethod: "api_key",
  fields: { api_key: "sk-ant-..." }
})

// Complete onboarding
await invoke("middleware_onboarding_complete")
```

## Notes

- Onboarding state is stored in `app_settings` table
- Provider manifests are read from `~/.openclaw/providers/` directory
- `onboardingFlow` and `onboardingCore` are the main entry points — they orchestrate the full flow
- `sign_out` clears provider/model selections; `delete_account` clears everything including identity
- Already migrated in: `components/onboarding/useOnboardingFlow.ts`
