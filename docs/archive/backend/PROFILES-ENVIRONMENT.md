# PROFILES-ENVIRONMENT.md

Scope: document the current backend/middleware contract for profiles, keychain token storage, environment connection state, and admin access prompts.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`

Current Tauri commands:
- `middleware_request_admin_access`
- `middleware_approve_admin_access`
- `middleware_profiles_list`
- `middleware_profiles_create`
- `middleware_profiles_update`
- `middleware_profiles_delete`
- `middleware_profile_token_set`
- `middleware_profile_token_get`
- `middleware_profile_token_delete`
- `middleware_environment_connect`
- `middleware_environment_status`
- `middleware_environment_detect`

## Admin access helpers

These are UI helpers, not real permission escalation by themselves.

### `middleware_request_admin_access`

### Input
```json
{
  "actionId": "sessions.patch",
  "actionLabel": "update session settings"
}
```

### Response
```json
{
  "status": "needs_admin",
  "title": "Admin access needed",
  "message": "To update session settings, this device needs extra permission for a sensitive action.",
  "primaryActionLabel": "Approve admin access",
  "secondaryActionLabel": "Not now",
  "requestPath": "/api/admin-access/approve",
  "showApproverPickerByDefault": false,
  "recommendedApprovers": [
    { "id": "owner", "name": "Workspace owner", "role": "Best default for fast approval" }
  ],
  "retry": {
    "gatewayMethod": "sessions.patch",
    "label": "update session settings",
    "openClawFlow": null
  }
}
```

### `middleware_approve_admin_access`

Returns a positive UI result plus retry instructions.

## Profile object

Current profile shape:
```json
{
  "id": "prof_xxx",
  "name": "My Laptop",
  "mode": "local",
  "gatewayUrl": "ws://127.0.0.1:18789",
  "workspaceRoot": "/root/.openclaw/workspace",
  "isDefault": true,
  "status": "connected",
  "lastUsedAt": null,
  "capabilities": {},
  "metadata": {},
  "lastError": null
}
```

## `middleware_profiles_list`

### Input
No input.

### Response
```json
{ "profiles": [] }
```

Ordered by `updated_at DESC`.

## `middleware_profiles_create`

### Input
```json
{
  "name": "My Laptop",
  "mode": "local",
  "gatewayUrl": "ws://127.0.0.1:18789",
  "workspaceRoot": "/root/.openclaw/workspace",
  "isDefault": true,
  "token": "secret"
}
```

### Behavior
- creates `prof_<uuid>`
- stores status as `disconnected`
- computes `capabilities` from workspace
- if `isDefault = true`, clears previous default first
- stores token in keychain when provided

### Response
```json
{ "profile": { "id": "prof_xxx" } }
```

## `middleware_profiles_update`

### Input
```json
{
  "profileId": "prof_xxx",
  "name": "Prod VPS",
  "gatewayUrl": "wss://server.example.com/ws",
  "workspaceRoot": "/srv/jarvis",
  "isDefault": false,
  "token": "secret"
}
```

All fields except `profileId` are optional.

### Behavior
- omitted fields keep existing values
- recomputes capabilities when workspace changes
- if `isDefault = true`, clears previous default first
- updates token when provided

## `middleware_profiles_delete`

### Input
```json
{ "profileId": "prof_xxx" }
```

### Response
```json
{ "ok": true, "deletedProfileId": "prof_xxx" }
```

Also deletes stored token.

## Token APIs

### `middleware_profile_token_set`
```json
{ "profileId": "prof_xxx", "token": "secret" }
```

### `middleware_profile_token_get`
```json
{ "profileId": "prof_xxx" }
```

Response:
```json
{ "profileId": "prof_xxx", "token": "secret-or-null" }
```

### `middleware_profile_token_delete`
```json
{ "profileId": "prof_xxx" }
```

## Environment APIs

### `middleware_environment_connect`

Marks a profile as connected and refreshes capabilities.

### Input
```json
{ "profileId": "prof_xxx" }
```

### Response
```json
{
  "ok": true,
  "profileId": "prof_xxx",
  "status": "connected",
  "capabilities": {}
}
```

Important note:
- current implementation is local-state oriented
- it does not prove a live remote Gateway session was established
- frontend should treat it as environment selection / readiness state, not a full authenticated socket proof

### `middleware_environment_status`

Returns persisted status plus capabilities.

### `middleware_environment_detect`

Recomputes capabilities from `workspaceRoot`.

## Frontend guidance

Use these APIs for:
- profile CRUD
- default environment selection
- secure token storage flows
- onboarding environment picker
- admin-needed UI prompts

Do not assume:
- `environment_connect` means a deep network health check passed
- admin access helper means the sensitive action itself has already been executed
