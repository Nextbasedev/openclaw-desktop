"use client"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type ConnectResult = {
  ok: boolean
  url?: string
  message?: string
  error?: string
  errorTitle?: string
  isLocal?: boolean
  isTailscale?: boolean
  addedOrigins?: string[]
  fix?: {
    description: string
    origins: string[]
    example: Record<string, unknown>
  }
}

type ErrorGuideConfig = {
  title: string
  variant: "destructive" | "warning"
  description: string
  steps: string[]
  commands?: { label: string; command: string }[]
  note?: string
}

function getErrorGuide(
  result: ConnectResult,
  gatewayUrl?: string,
): ErrorGuideConfig | null {
  const code = result.error
  if (!code || result.ok) return null

  switch (code) {
    case "gateway_not_running":
      return {
        title: "Gateway Not Running",
        variant: "destructive",
        description:
          "The OpenClaw gateway process is not running or not listening on the specified port.",
        steps: [
          "Start the OpenClaw gateway on the machine hosting it",
          "Verify the gateway is running and listening on the correct port",
          "Confirm the URL above matches the gateway's host and port",
        ],
        commands: [
          {
            label: "Start the gateway",
            command: "openclaw gateway start",
          },
          {
            label: "Check gateway status",
            command: "openclaw gateway status",
          },
        ],
      }

    case "gateway_not_responding":
      return {
        title: "Gateway Not Responding",
        variant: "destructive",
        description:
          "The connection was established but the gateway did not respond in time. It may be starting up or overloaded.",
        steps: [
          "Wait a few seconds and try again — the gateway may still be starting",
          "Check gateway logs for errors or high resource usage",
          "Restart the gateway if the issue persists",
        ],
        commands: [
          {
            label: "Restart gateway",
            command: "openclaw gateway restart",
          },
        ],
      }

    case "tailscale_unreachable":
      return {
        title: "Tailscale Network Unreachable",
        variant: "destructive",
        description:
          "The gateway URL uses a Tailscale IP (100.x.x.x) but the Tailscale network is not reachable.",
        steps: [
          "Install Tailscale if not already installed — download from tailscale.com/download",
          "Sign in and connect to your Tailscale network",
          "Verify this device and the gateway device are both online",
          "Check that the gateway's Tailscale IP matches the URL above",
        ],
        commands: [
          {
            label: "Start Tailscale",
            command: "tailscale up",
          },
          {
            label: "Check connection status",
            command: "tailscale status",
          },
          {
            label: "Find your Tailscale IP",
            command: "tailscale ip -4",
          },
          {
            label: "Ping the gateway device",
            command: `tailscale ping ${extractHost(gatewayUrl)}`,
          },
        ],
        note: "Both this device and the gateway device must be logged into the same Tailscale network (tailnet). If the gateway is on another machine, ensure Tailscale is running on that machine too.",
      }

    case "dns_failed":
      return {
        title: "Host Not Found",
        variant: "destructive",
        description:
          "The hostname in the gateway URL could not be resolved. DNS lookup failed.",
        steps: [
          "Double-check the hostname or IP address in the URL",
          "If using a custom domain, verify DNS records are configured",
          "If using Tailscale MagicDNS, ensure Tailscale is running",
          "Try using the IP address directly instead of a hostname",
        ],
      }

    case "network_timeout":
      return {
        title: "Network Unreachable",
        variant: "destructive",
        description:
          "The gateway host could not be reached within the timeout period.",
        steps: [
          "Check your internet connection",
          "Verify the gateway host is powered on and online",
          "Check for firewall rules blocking the connection",
          "If the gateway is on a remote network, verify VPN/Tailscale is connected",
        ],
      }

    case "identity_mismatch":
      return {
        title: "Device Identity Mismatch",
        variant: "destructive",
        description:
          "This device's identity (ED25519 key pair) does not match what the gateway expects. This typically happens when the gateway was restarted or the device identity was regenerated on one side but not the other.",
        steps: [
          "Delete the local device identity file so a fresh one will be generated",
          "Click \"Test Connection\" again — the app will create a new identity automatically",
          "If the problem persists, restart the gateway to clear its device registry",
        ],
        commands: [
          {
            label: "Delete identity (PowerShell)",
            command:
              'Remove-Item "$env:USERPROFILE\\.openclaw\\state\\identity\\device.json"',
          },
          {
            label: "Delete identity (macOS/Linux)",
            command:
              "rm ~/.openclaw/state/identity/device.json",
          },
          {
            label: "Then restart the gateway",
            command: "openclaw gateway restart",
          },
        ],
      }

    case "token_missing":
      return {
        title: "Authentication Token Missing",
        variant: "destructive",
        description:
          "No authentication token was found in the local configuration file.",
        steps: [
          "Paste your gateway authentication token in the field above",
          "Click \"Save & Connect\" to save it to your config",
          "You can find the token in your gateway's admin panel or config file",
        ],
        commands: [
          {
            label: "Config file location",
            command: "~/.openclaw/openclaw.json",
          },
        ],
      }

    case "token_invalid":
      return {
        title: "Authentication Failed",
        variant: "destructive",
        description:
          "The gateway rejected the authentication token. The token may be incorrect, expired, or revoked.",
        steps: [
          "Verify the token matches the one configured on the gateway",
          "Copy the token from your gateway admin panel and paste it above",
          "If the gateway was reinstalled, generate a new token",
        ],
        commands: [
          {
            label: "View gateway config",
            command:
              "cat ~/.openclaw/openclaw.json | grep token",
          },
        ],
      }

    case "protocol_error":
      return {
        title: "Gateway Protocol Error",
        variant: "destructive",
        description:
          "Connected to the gateway but did not receive the expected authentication challenge. The service at this URL may not be an OpenClaw gateway.",
        steps: [
          "Verify the URL points to an OpenClaw gateway (not another service)",
          "Check that the gateway port is correct (default: 18789)",
          "Update the gateway to the latest version",
        ],
        commands: [
          {
            label: "Update gateway",
            command: "openclaw update",
          },
        ],
      }

    case "protocol_mismatch":
      return {
        title: "Protocol Version Mismatch",
        variant: "destructive",
        description:
          "This app and the gateway are running incompatible protocol versions.",
        steps: [
          "Update the OpenClaw gateway to the latest version",
          "Update this app to the latest version",
          "If both are up to date, check the release notes for breaking changes",
        ],
        commands: [
          {
            label: "Update gateway",
            command: "openclaw update",
          },
        ],
      }

    case "connect_timeout":
      return {
        title: "Connection Timeout",
        variant: "warning",
        description:
          "The gateway accepted the connection but took too long to complete authentication. It may be overloaded.",
        steps: [
          "Wait a moment and try again",
          "Check gateway logs for errors or high load",
          "Restart the gateway if the problem continues",
        ],
        commands: [
          {
            label: "Restart gateway",
            command: "openclaw gateway restart",
          },
        ],
      }

    case "connection_reset":
      return {
        title: "Connection Reset by Gateway",
        variant: "destructive",
        description:
          "The gateway abruptly closed the connection. It may have crashed or rejected this client.",
        steps: [
          "Check gateway logs for crash reports or error messages",
          "Restart the gateway",
          "If the problem persists, check the gateway's max connection limits",
        ],
        commands: [
          {
            label: "Check gateway logs",
            command: "openclaw gateway logs",
          },
          {
            label: "Restart gateway",
            command: "openclaw gateway restart",
          },
        ],
      }

    case "tls_error":
      return {
        title: "TLS/SSL Certificate Error",
        variant: "destructive",
        description:
          "The secure connection failed due to a certificate issue (self-signed, expired, or hostname mismatch).",
        steps: [
          "If using a self-signed certificate, configure the gateway with a valid certificate",
          "For local development, use ws:// instead of wss://",
          "Verify the certificate's hostname matches the gateway URL",
          "Check if the certificate has expired",
        ],
      }

    case "scope_denied":
      return {
        title: "Insufficient Permissions",
        variant: "destructive",
        description:
          "The gateway denied this client the required access scopes. The token may have restricted permissions.",
        steps: [
          "Check the gateway's user/token permissions in the admin panel",
          "Ensure the token has operator.read, operator.write, and operator.approvals scopes",
          "Generate a new token with full operator permissions if needed",
        ],
      }

    case "rate_limited":
      return {
        title: "Rate Limited",
        variant: "warning",
        description:
          "The gateway is rejecting connections because too many requests have been made in a short period.",
        steps: [
          "Wait 30-60 seconds and try again",
          "If this persists, check whether other clients are flooding the gateway",
          "Review the gateway's rate limit configuration",
        ],
      }

    case "max_connections":
      return {
        title: "Too Many Connections",
        variant: "warning",
        description:
          "The gateway has reached its maximum number of simultaneous connections.",
        steps: [
          "Close other OpenClaw clients or browser tabs connected to the gateway",
          "Wait a moment for stale connections to be cleaned up",
          "If needed, increase the gateway's connection limit in its config",
        ],
        commands: [
          {
            label: "Check active connections",
            command: "openclaw gateway status",
          },
        ],
      }

    case "server_unavailable":
      return {
        title: "Gateway Unavailable",
        variant: "warning",
        description:
          "The gateway is temporarily unavailable — it may be shutting down, restarting, or under maintenance.",
        steps: [
          "Wait a moment and try again",
          "If the gateway was intentionally stopped, restart it",
          "Check if an update is in progress",
        ],
        commands: [
          {
            label: "Start gateway",
            command: "openclaw gateway start",
          },
        ],
      }

    case "device_not_registered":
      return {
        title: "Device Not Registered",
        variant: "destructive",
        description:
          "This device is not recognized by the gateway. The device may need to be paired or re-registered.",
        steps: [
          "Delete the local device identity so a new one is generated",
          'Click "Test Connection" to create a fresh identity and register with the gateway',
          "If the gateway requires manual device approval, check its admin panel",
        ],
        commands: [
          {
            label: "Delete identity (PowerShell)",
            command:
              'Remove-Item "$env:USERPROFILE\\.openclaw\\state\\identity\\device.json"',
          },
          {
            label: "Delete identity (macOS/Linux)",
            command:
              "rm ~/.openclaw/state/identity/device.json",
          },
        ],
      }

    case "token_expired":
      return {
        title: "Token Expired",
        variant: "destructive",
        description:
          "The authentication token has expired and is no longer accepted by the gateway.",
        steps: [
          "Generate a new token from the gateway admin panel",
          "Paste the new token in the field above",
          'Click "Save & Connect" to update your configuration',
        ],
      }

    case "permission_denied":
      return {
        title: "File Permission Denied",
        variant: "destructive",
        description:
          "The app cannot read or write its configuration files due to filesystem permissions.",
        steps: [
          "Check that your user account has read/write access to ~/.openclaw/",
          "Fix permissions on the OpenClaw config directory",
          "If on a shared machine, ensure your user owns the config files",
        ],
        commands: [
          {
            label: "Fix permissions (macOS/Linux)",
            command: "chmod -R u+rw ~/.openclaw/",
          },
          {
            label: "Check ownership (macOS/Linux)",
            command: "ls -la ~/.openclaw/",
          },
        ],
      }

    case "config_corrupt":
      return {
        title: "Configuration File Corrupt",
        variant: "destructive",
        description:
          "The configuration file at ~/.openclaw/openclaw.json contains invalid JSON and could not be parsed.",
        steps: [
          "Open the config file and fix the JSON syntax error",
          "Or delete the file and re-enter your settings here — a fresh config will be created",
          "If you have a backup, restore it",
        ],
        commands: [
          {
            label: "Config file location",
            command: "~/.openclaw/openclaw.json",
          },
          {
            label:
              "Delete and recreate (PowerShell)",
            command:
              'Remove-Item "$env:USERPROFILE\\.openclaw\\openclaw.json"',
          },
          {
            label:
              "Delete and recreate (macOS/Linux)",
            command: "rm ~/.openclaw/openclaw.json",
          },
        ],
      }

    case "config_not_ready":
      return {
        title: "Configuration Incomplete",
        variant: "warning",
        description:
          "The gateway URL or device identity has not been set up yet.",
        steps: [
          "Enter the gateway WebSocket URL in the field above",
          "Paste your authentication token",
          'Click "Save & Connect" to save and generate a device identity',
        ],
      }

    case "origin_fixed_restart":
      return {
        title: "Origins Configured — Restart Required",
        variant: "warning",
        description:
          result.message ??
          "Allowed origins have been added to your gateway config automatically.",
        steps: [
          "Restart the OpenClaw gateway to apply the new origin settings",
          "Click \"Test Connection\" again after restarting",
        ],
        commands: [
          {
            label: "Restart gateway",
            command: "openclaw gateway restart",
          },
        ],
      }

    case "origin_not_allowed":
      return {
        title: "Origin Not Allowed",
        variant: "destructive",
        description:
          "The remote gateway is blocking this app's origin. You need to add allowed origins on the gateway server.",
        steps: [
          'Open the gateway\'s openclaw.json config file on the remote machine',
          'Add the required origins to "gateway.controlUi.allowedOrigins"',
          "Restart the gateway and try again",
        ],
        commands: result.fix
          ? [
              {
                label: "Add this to openclaw.json",
                command: JSON.stringify(
                  result.fix.example,
                  null,
                  2,
                ),
              },
              {
                label: "Then restart",
                command: "openclaw gateway restart",
              },
            ]
          : [
              {
                label: "Then restart",
                command: "openclaw gateway restart",
              },
            ],
      }

    default:
      return {
        title: result.errorTitle ?? "Connection Failed",
        variant: "destructive",
        description:
          result.message ??
          "An unexpected error occurred while connecting to the gateway.",
        steps: [
          "Verify the gateway URL and token are correct",
          "Ensure the gateway is running and reachable",
          "Check gateway logs for more details",
          "Restart the gateway and try again",
        ],
        commands: [
          {
            label: "Check gateway status",
            command: "openclaw gateway status",
          },
          {
            label: "View gateway logs",
            command: "openclaw gateway logs",
          },
        ],
      }
  }
}

function classifyRawError(
  msg: string,
): ErrorGuideConfig {
  const lower = msg.toLowerCase()

  if (lower.includes("backend became ready") || lower.includes("failed to fetch")) {
    return {
      title: "Jarvis Backend URL Misconfigured or Not Running",
      variant: "destructive",
      description:
        "The UI could not reach the Jarvis middleware backend. In browser/Funnel mode, the UI must call the same-origin Next proxy (/api/ipc/* and /api/stream/*), not http://127.0.0.1:3001 directly from the browser.",
      steps: [
        "Restart the app completely",
        "If running in development, ensure both services are running: UI on port 3000 and middleware backend on port 3001",
        "For browser/Funnel deployments, change client calls to use relative URLs like /api/ipc/<command>; keep 127.0.0.1:3001 only on the server side or set JARVIS_SERVER_URL/NEXT_PUBLIC_SERVER_URL to the backend origin",
        "Check that port 3001 is not blocked by another process",
      ],
      commands: [
        {
          label: "Check backend through the UI proxy",
          command: "curl http://127.0.0.1:3000/api/health",
        },
        {
          label: "Check middleware backend directly on the server",
          command: "curl http://127.0.0.1:3001/health",
        },
      ],
    }
  }

  if (lower.includes("ipc call failed")) {
    return {
      title: "Internal Communication Error",
      variant: "destructive",
      description:
        "The UI could not communicate with the app's backend server. It may have crashed or become unresponsive.",
      steps: [
        "Restart the app",
        "If the issue persists, check for errors in the server logs",
        "Ensure no firewall is blocking localhost connections",
      ],
    }
  }

  if (
    lower.includes("eperm") ||
    lower.includes("eacces") ||
    lower.includes("permission denied")
  ) {
    return {
      title: "File Permission Denied",
      variant: "destructive",
      description:
        "The app cannot write to its configuration directory due to filesystem permissions.",
      steps: [
        "Check that your user has read/write access to ~/.openclaw/",
        "Fix permissions on the OpenClaw config directory",
      ],
      commands: [
        {
          label: "Fix permissions (macOS/Linux)",
          command: "chmod -R u+rw ~/.openclaw/",
        },
      ],
    }
  }

  if (
    lower.includes("unexpected token") ||
    (lower.includes("json") && lower.includes("parse"))
  ) {
    return {
      title: "Configuration File Corrupt",
      variant: "destructive",
      description:
        "A configuration file contains invalid JSON. Delete it and re-enter your settings.",
      steps: [
        "Delete ~/.openclaw/openclaw.json",
        "Re-enter your gateway URL and token above",
        'Click "Save & Connect" to create a fresh config',
      ],
    }
  }

  return {
    title: "Unexpected Error",
    variant: "destructive",
    description: msg,
    steps: [
      "Restart the app and try again",
      "If the issue persists, check the app and gateway logs",
    ],
  }
}

function extractHost(
  url: string | undefined,
): string {
  if (!url) return "<gateway-ip>"
  try {
    const parsed = new URL(
      url
        .replace("ws://", "http://")
        .replace("wss://", "https://"),
    )
    return parsed.hostname
  } catch {
    return "<gateway-ip>"
  }
}

export default function ConnectionErrorGuide({
  result,
  rawError,
  gatewayUrl,
}: {
  result: ConnectResult | null
  rawError: string | null
  gatewayUrl?: string
}) {
  if (rawError && !result) {
    const guide = classifyRawError(rawError)
    const isWarning = guide.variant === "warning"
    const borderClass = isWarning
      ? "border-yellow-500/30 bg-yellow-500/5"
      : "border-destructive/30 bg-destructive/5"
    const titleClass = isWarning
      ? "text-yellow-700 dark:text-yellow-400"
      : "text-destructive"

    return (
      <Card className={borderClass}>
        <CardHeader className="pb-2">
          <CardTitle className={titleClass}>
            {guide.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {guide.description}
          </p>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">
              How to fix:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          {guide.commands &&
            guide.commands.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">
                  Commands:
                </p>
                <div className="space-y-1">
                  {guide.commands.map((cmd) => (
                    <div key={cmd.label}>
                      <p className="text-xs text-muted-foreground">
                        {cmd.label}:
                      </p>
                      <pre className="overflow-x-auto rounded bg-muted px-3 py-1.5 font-mono text-xs">
                        {cmd.command}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Raw error details
            </summary>
            <pre className="mt-1 overflow-x-auto rounded bg-muted px-3 py-1.5 font-mono">
              {rawError}
            </pre>
          </details>
        </CardContent>
      </Card>
    )
  }

  if (!result || result.ok) return null

  const guide = getErrorGuide(result, gatewayUrl)
  if (!guide) return null

  const isWarning = guide.variant === "warning"
  const borderClass = isWarning
    ? "border-yellow-500/30 bg-yellow-500/5"
    : "border-destructive/30 bg-destructive/5"
  const titleClass = isWarning
    ? "text-yellow-700 dark:text-yellow-400"
    : "text-destructive"

  return (
    <Card className={borderClass}>
      <CardHeader className="pb-2">
        <CardTitle className={titleClass}>
          {guide.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {guide.description}
        </p>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            How to fix:
          </p>
          <ol className="list-inside list-decimal space-y-1 text-sm">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        {guide.commands && guide.commands.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">
              Commands:
            </p>
            <div className="space-y-1">
              {guide.commands.map((cmd) => (
                <div key={cmd.label}>
                  <p className="text-xs text-muted-foreground">
                    {cmd.label}:
                  </p>
                  <pre className="overflow-x-auto rounded bg-muted px-3 py-1.5 font-mono text-xs">
                    {cmd.command}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {guide.note && (
          <p className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
            {guide.note}
          </p>
        )}

        {result.message &&
          result.error !== "origin_fixed_restart" &&
          result.error !== "config_not_ready" && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Raw error details
              </summary>
              <pre className="mt-1 overflow-x-auto rounded bg-muted px-3 py-1.5 font-mono">
                {result.message}
              </pre>
            </details>
          )}
      </CardContent>
    </Card>
  )
}
