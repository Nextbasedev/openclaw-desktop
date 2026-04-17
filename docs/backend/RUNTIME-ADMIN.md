# RUNTIME-ADMIN.md

Scope: document the current backend/middleware contract for runtime info and admin-access helper APIs.

Source of truth:
- `packages/desktop/src-tauri/src/middleware.rs`

Current Tauri commands:
- `middleware_runtime_info`
- `middleware_request_admin_access`
- `middleware_approve_admin_access`

## `middleware_runtime_info`

Returns middleware contract metadata.

### Input
No input.

### Response
```json
{
  "contractVersion": 1,
  "transport": "tauri-ipc+gateway-ws+sqlite+keychain+pty+filesystem"
}
```

Use for:
- frontend compatibility checks
- debug/about screen
- feature gating by contract version if needed later

## `middleware_request_admin_access`

This is a UI helper to generate a friendly admin-needed state for sensitive actions.
It does not itself perform the target action.

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
  "message": "To update session settings, this device needs extra permission for a sensitive action. Approve once, then Jarvis can continue automatically.",
  "primaryActionLabel": "Approve admin access",
  "secondaryActionLabel": "Not now",
  "requestPath": "/api/admin-access/approve",
  "showApproverPickerByDefault": false,
  "recommendedApprovers": [
    {
      "id": "owner",
      "name": "Workspace owner",
      "role": "Best default for fast approval"
    },
    {
      "id": "admin",
      "name": "Admin operator",
      "role": "Use only when someone else needs to approve"
    }
  ],
  "retry": {
    "gatewayMethod": "sessions.patch",
    "label": "update session settings",
    "openClawFlow": null
  }
}
```

### Product direction confirmed
- do not show all approvers by default
- keep flow simple first
- reveal approver choices only when explicitly needed

## `middleware_approve_admin_access`

Returns a positive approval result plus retry instructions.

### Input
```json
{
  "actionId": "sessions.patch"
}
```

### Response
```json
{
  "status": "approved",
  "approved": true,
  "retry": {
    "gatewayMethod": "sessions.patch",
    "label": null,
    "openClawFlow": ["connect", "sessions.patch"]
  },
  "message": "Admin access approved"
}
```

## Frontend guidance

Use these APIs for:
- blocked-action UI
- admin escalation dialog copy
- retry CTA generation
- runtime/contract inspection screens

Do not assume:
- `approve_admin_access` means the blocked Gateway call has already succeeded
- these helpers provide real security by themselves

They are middleware UX helpers around the actual follow-up action flow.
