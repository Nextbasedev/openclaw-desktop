# ONBOARDING-FRONTEND.md

Purpose: help frontend implement the new core onboarding flow without reading Rust code.

Primary endpoint:
- `middleware_onboarding_core`

Use this as the single source for onboarding UI.

---

## 1. What this endpoint does

`middleware_onboarding_core` checks whether the machine is ready for Jarvis to run with OpenClaw.

It handles these prerequisites in order:
1. Node.js
2. npm
3. OpenClaw CLI
4. OpenClaw Gateway

Frontend should use this endpoint for the entire onboarding flow.

---

## 2. Endpoint name

```ts
middleware_onboarding_core
```

---

## 3. Input

### Check current state
```json
{
  "action": "check"
}
```

### Try to auto-fix what can be fixed
```json
{
  "action": "apply"
}
```

### Optional custom gateway URL
```json
{
  "action": "check",
  "gatewayUrl": "ws://127.0.0.1:18789"
}
```

### Input fields
- `action?: "check" | "apply"`
- `gatewayUrl?: string`

Defaults:
- if `action` is omitted, backend behaves like `check`
- if `gatewayUrl` is omitted, backend uses the default local OpenClaw gateway URL

---

## 4. Response shape

```json
{
  "action": "check",
  "applied": false,
  "canAutoFix": true,
  "status": {
    "node": {
      "installed": true,
      "version": "v22.22.0"
    },
    "npm": {
      "installed": true,
      "version": "10.9.3"
    },
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
  "actionsRun": []
}
```

---

## 5. Meaning of top-level fields

### `action`
The action the backend actually processed.

Values:
- `check`
- `apply`

### `applied`
Whether backend actually executed an auto-fix step.

Examples:
- `false` for a passive status check
- `true` when it ran `npm i -g openclaw`
- `true` when it ran `openclaw gateway start`

### `canAutoFix`
Whether the next missing step can be auto-fixed by backend.

Examples:
- `false` if Node.js is missing
- `false` if npm is missing
- `true` if OpenClaw can be installed via npm
- `true` if gateway can be started
- `true` if already ready

### `actionsRun`
List of commands/actions backend actually executed during `apply`.

Examples:
```json
[]
```

or
```json
["npm i -g openclaw"]
```

or
```json
["npm i -g openclaw", "openclaw gateway start"]
```

---

## 6. Meaning of `status`

### `status.node`
```json
{
  "installed": true,
  "version": "v22.22.0"
}
```

### `status.npm`
```json
{
  "installed": true,
  "version": "10.9.3"
}
```

### `status.openclaw`
```json
{
  "installed": true,
  "version": "openclaw 0.x.x",
  "installMethod": "npm i -g openclaw"
}
```

### `status.gateway`
```json
{
  "url": "ws://127.0.0.1:18789",
  "running": true,
  "status": "running"
}
```

### `status.recommendation`
This is the key field frontend should branch on.

Possible values:
- `install_node`
- `install_npm`
- `install_openclaw`
- `start_gateway`
- `ready`

---

## 7. Recommendation meanings

### `install_node`
Node.js is missing.

Frontend should:
- show Node.js install step
- explain that backend cannot auto-install it yet
- show manual CTA
- after user installs Node.js, call `check` again

### `install_npm`
npm is missing.

Frontend should:
- show npm install/help step
- tell user manual action is required
- call `check` again after user fixes it

### `install_openclaw`
Node and npm are available, but OpenClaw is missing.

Frontend should:
- show “Install OpenClaw” button
- call `middleware_onboarding_core({ action: "apply" })`

Backend will attempt:
```bash
npm i -g openclaw
```

### `start_gateway`
OpenClaw is installed, but gateway is not running.

Frontend should:
- show “Start Gateway” or “Continue setup” button
- call `middleware_onboarding_core({ action: "apply" })`

Backend will attempt:
```bash
openclaw gateway start
```

### `ready`
Everything needed for core onboarding is ready.

Frontend should:
- mark onboarding complete
- continue to next setup step, for example bot name or channel setup

---

## 8. Manual-action response shape

When backend cannot auto-fix the next missing prerequisite, response may include:

```json
{
  "action": "apply",
  "applied": false,
  "canAutoFix": false,
  "message": "Node.js is not installed. Install Node.js first, then rerun onboarding.",
  "manualAction": "install_node",
  "docsUrl": "https://nodejs.org/en/download",
  "status": {
    "recommendation": "install_node"
  },
  "actionsRun": []
}
```

Possible extra fields:
- `message`
- `manualAction`
- `docsUrl`

Frontend should render these directly when present.

---

## 9. Recommended frontend flow

### Initial load
Call:
```ts
invoke("middleware_onboarding_core", { action: "check" })
```

### Render screen from `status.recommendation`
Use the recommendation to decide which state to show.

### When user clicks main CTA
If current recommendation is:
- `install_openclaw` → call `apply`
- `start_gateway` → call `apply`
- `install_node` or `install_npm` → show manual guidance
- `ready` → continue

### After `apply`
Use returned `status` immediately.
No extra re-fetch is required unless frontend wants one.

---

## 10. Example frontend state machine

```ts
switch (response.status.recommendation) {
  case "install_node":
    // show manual node install step
    break;
  case "install_npm":
    // show manual npm install step
    break;
  case "install_openclaw":
    // show install openclaw CTA
    break;
  case "start_gateway":
    // show start gateway CTA
    break;
  case "ready":
    // go to next screen
    break;
}
```

---

## 11. UX suggestions

### Good CTA labels
- `install_node` → `Install Node.js`
- `install_npm` → `Fix npm`
- `install_openclaw` → `Install OpenClaw`
- `start_gateway` → `Start OpenClaw Gateway`
- `ready` → `Continue`

### Good loading labels
- `Checking system`
- `Installing OpenClaw`
- `Starting Gateway`

### Good success transition
When recommendation becomes `ready`:
- show short success state
- continue to bot name / channel config step

---

## 12. Error handling

If Tauri invoke fails, frontend should show:
- short user-friendly summary
- expandable raw error details

Common cases:
- npm install failed
- gateway start failed
- unsupported environment
- shell command could not run

Do not guess. Show returned error text.

---

## 13. Important product rule

This endpoint is now the main onboarding API.

Do not build onboarding UI around:
- git remotes
- repo root selection
- project setup first

Those are advanced flows after core onboarding is complete.

---

## 14. Related docs

For lower-level backend details:
- `docs/backend/ONBOARDING.md`

For bot name setup after onboarding:
- `docs/backend/RUNTIME-ADMIN.md` plus bot-name endpoint docs there
