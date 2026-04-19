# Feature Migration: Profiles

## Overview

Profiles represent backend environments (local or remote). Each profile has a gateway URL, workspace root, and optional auth token.

## Commands

| Command | Method | Args |
|---------|--------|------|
| `middleware_profiles_list` | POST | `{}` |
| `middleware_profiles_create` | POST | `{ name, mode, gatewayUrl, workspaceRoot, token?, isDefault? }` |
| `middleware_profiles_update` | POST | `{ profileId, name?, gatewayUrl?, workspaceRoot?, token?, isDefault? }` |
| `middleware_profiles_delete` | POST | `{ profileId }` |
| `middleware_profile_token_set` | POST | `{ profileId, token }` |
| `middleware_profile_token_get` | POST | `{ profileId }` |
| `middleware_profile_token_delete` | POST | `{ profileId }` |
| `middleware_environment_connect` | POST | `{ profileId }` |
| `middleware_environment_status` | POST | `{ profileId }` |
| `middleware_environment_detect` | POST | `{ profileId }` |

## Response Shapes

### Profile object

```typescript
interface Profile {
  id: string           // "prof_xxxxxxxx"
  name: string
  mode: string         // "local" | "remote"
  gatewayUrl: string
  workspaceRoot: string
  isDefault: boolean
  status: string | null
  lastUsedAt: string | null
  lastError: string | null
  capabilities: unknown | null
  metadata: unknown | null
  createdAt: string    // ISO 8601
  updatedAt: string    // ISO 8601
}
```

### profilesList response

```json
{ "profiles": [Profile, ...] }
```

### profilesCreate / profilesUpdate response

```json
{ "profile": Profile }
```

## Migration Steps

### Before (Tauri)

```typescript
const { invoke } = window.__TAURI__.core

const { profiles } = await invoke("middleware_profiles_list")
const { profile } = await invoke("middleware_profiles_create", {
  name: "My Local",
  mode: "local",
  gatewayUrl: "http://localhost:18789",
  workspaceRoot: "/home/user/workspace",
})
```

### After (Universal)

```typescript
import { invoke } from "@/lib/ipc"

const { profiles } = await invoke("middleware_profiles_list")
const { profile } = await invoke("middleware_profiles_create", {
  name: "My Local",
  mode: "local",
  gatewayUrl: "http://localhost:18789",
  workspaceRoot: "/home/user/workspace",
})
```

## Error Cases

- `"Profile not found: {profileId}"` — invalid profileId
- `"Profile name already exists"` — duplicate name (case-insensitive)
- `"Cannot delete the default profile"` — tried to delete default
- `"At least one profile must remain"` — tried to delete last profile

## Tokens

Tokens are stored in the `app_settings` SQLite table (not keychain). In Tauri, tokens were in the OS keychain. In web mode, they're in SQLite as `profile_token:{profileId}`.

## Notes

- Profile names use `COLLATE NOCASE` — "My Profile" and "my profile" are the same
- `isDefault` is exclusive — setting one profile as default unsets all others
- `mode` is stored but not enforced by the server — it's a UI hint
