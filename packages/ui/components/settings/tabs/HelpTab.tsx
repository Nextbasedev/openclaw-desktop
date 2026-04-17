"use client"

type HelpLink = {
  label: string
  description: string
  url: string
}

const HELP_LINKS: HelpLink[] = [
  { label: "Documentation", description: "Read the official OpenClaw docs", url: "https://docs.openclaw.ai" },
  { label: "Community Discord", description: "Join the community", url: "https://discord.com/invite/clawd" },
  { label: "GitHub", description: "Report issues and view source", url: "https://github.com/openclaw/openclaw" },
  { label: "Keyboard Shortcuts", description: "View all shortcuts", url: "#" },
]

type HelpTabProps = {
  links?: HelpLink[]
}

export function HelpTab({ links = HELP_LINKS }: HelpTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Help</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resources and support for OpenClaw Desktop.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target={link.url.startsWith("http") ? "_blank" : undefined}
            rel={link.url.startsWith("http") ? "noopener noreferrer" : undefined}
            className="flex flex-col gap-0.5 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border hover:bg-muted/30"
          >
            <span className="text-sm font-medium text-foreground">
              {link.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {link.description}
            </span>
          </a>
        ))}
      </div>

      <div className="rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        OpenClaw Desktop v0.1.0 · Built with Tauri + Next.js
      </div>
    </div>
  )
}
