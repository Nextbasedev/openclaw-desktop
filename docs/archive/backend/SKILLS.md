# Jarvis Desktop Skills Backend Contract

Backend files:
- `packages/desktop/src-tauri/src/middleware.rs`
- `packages/desktop/src-tauri/src/lib.rs`
- `packages/shared/src/api/skills.ts`

## Commands

- `middleware_skills_discover`
- `middleware_skills_install`

## Discovery

### `middleware_skills_discover`

Input:
```json
{
  "query": "openclaw",
  "limit": 8,
  "includeLocal": true,
  "includeClawHub": true,
  "includeGithubProbe": true
}
```

Response:
```json
{
  "query": "openclaw",
  "results": [
    {
      "id": "clawhub:openclaw-cli",
      "slug": "openclaw-cli",
      "name": "OpenClaw CLI",
      "summary": "Operate and troubleshoot the OpenClaw CLI...",
      "description": "Operate and troubleshoot the OpenClaw CLI...",
      "source": "clawhub",
      "version": "1.0.0",
      "installed": false,
      "installSource": "clawhub",
      "repoUrl": null,
      "homepageUrl": "https://clawhub.com",
      "localPath": null,
      "tags": ["latest"]
    }
  ],
  "warnings": [],
  "sources": ["local", "clawhub", "github"]
}
```

Behavior:
- local skills are scanned from `~/.openclaw/skills` and `~/.openclaw/workspace/skills`
- ClawHub is the primary remote discovery source
- GitHub probing is secondary and only runs for exact GitHub repo style queries such as:
  - `owner/repo`
  - `https://github.com/owner/repo`
- duplicate slugs are merged down to one frontend-friendly result

## Install

### `middleware_skills_install`

Input examples:

ClawHub:
```json
{
  "source": "clawhub",
  "slug": "openclaw-cli",
  "version": "1.0.0",
  "scope": "user",
  "force": false
}
```

GitHub:
```json
{
  "source": "github",
  "repoUrl": "https://github.com/example/my-skill",
  "ref": "main",
  "scope": "workspace",
  "force": true
}
```

Local path:
```json
{
  "source": "local",
  "localPath": "/tmp/my-skill",
  "scope": "user"
}
```

Response:
```json
{
  "status": "installed",
  "skill": {
    "id": "clawhub:openclaw-cli",
    "slug": "openclaw-cli",
    "name": "OpenClaw CLI",
    "summary": "Operate and troubleshoot the OpenClaw CLI...",
    "description": "Operate and troubleshoot the OpenClaw CLI...",
    "source": "clawhub",
    "version": "1.0.0",
    "installed": true,
    "installSource": "clawhub",
    "repoUrl": null,
    "homepageUrl": "https://clawhub.com",
    "localPath": "/home/user/.openclaw/skills/openclaw-cli",
    "tags": []
  },
  "location": {
    "scope": "user",
    "root": "/home/user/.openclaw/skills",
    "path": "/home/user/.openclaw/skills/openclaw-cli"
  },
  "actions": ["clawhub install openclaw-cli"],
  "warnings": []
}
```

Behavior:
- `source=clawhub` runs `clawhub install` into an OpenClaw-compatible skills directory
- `source=github` clones a SKILL.md repo into the selected skills directory
- `source=local` copies an existing local skill folder into the selected skills directory
- `scope=user` installs to `~/.openclaw/skills`
- `scope=workspace` installs to `~/.openclaw/workspace/skills`
- if a skill already exists and `force` is false, the API returns current metadata with a warning instead of overwriting
