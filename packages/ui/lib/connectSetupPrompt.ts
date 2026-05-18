export type ConnectSetupMode = "local" | "remote"

const REPO_URL = "https://github.com/Nextbasedev/openclaw-desktop.git"
const REPO_BRANCH = "dev-3"
const INSTALL_DOC = "docs/installation/README.md"
const SMOKE_TEST = "docs/installation/desktop-middleware-smoke-test.sh"

function modeDetails(mode: ConnectSetupMode) {
  if (mode === "local") {
    return {
      label: "LOCAL",
      host: "127.0.0.1",
      where: "on this same computer as OpenClaw Desktop",
      urlHint: "http://127.0.0.1:8787",
      network: "local loopback",
    }
  }

  return {
    label: "REMOTE",
    host: "0.0.0.0",
    where: "on this VPS/server so OpenClaw Desktop can reach it over the network",
    urlHint: "reachable HTTPS domain, Tailscale URL, private IP, or public IP:8787",
    network: "public domain | tailscale | private ip | public ip | reverse proxy",
  }
}

export function buildOpenClawSetupPrompt(mode: ConnectSetupMode) {
  const details = modeDetails(mode)
  return `Set up OpenClaw Desktop Middleware in ${details.label} mode.

Repo: ${REPO_URL}
Branch: ${REPO_BRANCH}
Install location: clone/update this repo, then follow ${INSTALL_DOC}
Mode target: run Middleware ${details.where}
Host env: HOST=${details.host}
URL to return: ${details.urlHint}

Official OpenClaw Gateway scopes required from code: operator.read, operator.write, operator.approvals, operator.admin. Desktop workspace/git/terminal are Middleware HTTP APIs, not extra Gateway scopes.

After install, run the required curl smoke test from repo root:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_PAIRING_CODE=<pairing-code> ${SMOKE_TEST}

If you already know the token:
MIDDLEWARE_TEST_URL=<middleware-url> MIDDLEWARE_TOKEN=<token> ${SMOKE_TEST}

Only return URL/code after the script prints DESKTOP_MIDDLEWARE_SMOKE_TEST_OK. If it fails due to missing model/API key, say Middleware works but chat model/provider config is the blocker. Otherwise fix and rerun.

Final output only:
Middleware URL: <reachable-url>
Pairing code: <code>
Network note: ${details.network}
Verified: desktop-smoke-test passed
Blocker: <none | exact blocker>`
}

export const LOCAL_OPENCLAW_PROMPT = buildOpenClawSetupPrompt("local")
export const VPS_OPENCLAW_PROMPT = buildOpenClawSetupPrompt("remote")
