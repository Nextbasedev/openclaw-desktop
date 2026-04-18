# ONBOARDING.md

Scope: document the current backend/middleware contract for Jarvis core onboarding.

Goal:
- frontend uses one core onboarding surface
- onboarding focuses on prerequisites needed to run Jarvis with OpenClaw
- git/repo setup is no longer the center of onboarding

---

## 1. Current core onboarding surface

The current onboarding backend lives in:
- `packages/desktop/src-tauri/src/middleware.rs`
- command registration in `packages/desktop/src-tauri/src/lib.rs`

Primary command:
- `middleware_onboarding_core`

Compatibility helpers still available:
- `middleware_openclaw_check`
- `middleware_openclaw_install`

Advanced repo utilities, not core onboarding:
- `middleware_git_remote_add`
- `middleware_git_remote_list`
- `middleware_git_remote_remove`

---

## 2. Core onboarding philosophy

Jarvis core onboarding should answer one question:
- can this machine run OpenClaw and reach a running Gateway yet?

So the onboarding priority order is:
1. Node.js
2. npm
3. OpenClaw CLI
4. OpenClaw Gateway
5. bot/channel setup in frontend

Git is optional for later repo workflows. It is not a core prerequisite for first-run onboarding.

---

## 3. `middleware_onboarding_core`

This is the main endpoint frontend should use.

### Input
```json
{
  "action": "check",
  "gatewayUrl": "ws://127.0.0.1:18789"
}
```

Fields:
- `action`: optional, `check` or `apply`
- `gatewayUrl`: optional, defaults to `ws://127.0.0.1:${DEFAULT_GATEWAY_PORT}`

### `check` behavior
Returns full onboarding status without changing the machine.

### `apply` behavior
Attempts safe automatic setup in this order:
1. if Node.js missing → returns manual action required
2. if npm missing → returns manual action required
3. if OpenClaw missing and npm exists → runs `npm i -g openclaw`
4. if Gateway not running and OpenClaw exists → runs `openclaw gateway start`
5. returns final status snapshot

### Response shape
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

### Recommendation values
- `install_node`
- `install_npm`
- `install_openclaw`
- `start_gateway`
- `ready`

### Manual-action response example
When Node.js is missing:
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

### Frontend guidance
Use this flow:
1. call `middleware_onboarding_core({ action: "check" })`
2. render current prerequisite state
3. if user clicks continue/fix, call `middleware_onboarding_core({ action: "apply" })`
4. if response becomes `ready`, continue to bot-name/channel setup
5. if response requires manual Node/npm install, show CTA + help text

---

## 4. Compatibility helper: `middleware_openclaw_check`

This older endpoint still exists for compatibility.

### Input
```json
{
  "gatewayUrl": "ws://127.0.0.1:18789"
}
```

### Response
```json
{
  "installed": true,
  "running": true,
  "version": "openclaw 0.x.x",
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "running": true,
    "status": "running"
  },
  "recommendation": "ready",
  "core": {
    "node": { "installed": true },
    "npm": { "installed": true },
    "openclaw": { "installed": true },
    "gateway": { "running": true },
    "recommendation": "ready"
  }
}
```

Compatibility mapping:
- core `install_node` / `install_npm` / `install_openclaw` → legacy `install`
- core `start_gateway` → legacy `start`
- core `ready` → legacy `ready`

---

## 5. Compatibility helper: `middleware_openclaw_install`

This older endpoint now delegates to the core onboarding apply flow.

### Behavior
- attempts `middleware_onboarding_core({ action: "apply" })`
- installs OpenClaw via npm when possible
- starts gateway when possible
- returns resulting status

### Response
```json
{
  "installed": true,
  "running": true,
  "actionsRun": [
    "npm i -g openclaw",
    "openclaw gateway start"
  ],
  "status": {
    "recommendation": "ready"
  }
}
```

---

## 6. Git endpoints

These still exist, but they are advanced repo setup utilities rather than core onboarding.

Commands:
- `middleware_git_remote_add`
- `middleware_git_remote_list`
- `middleware_git_remote_remove`

Use them only after onboarding is complete, when the product enters repo/project management flows.
