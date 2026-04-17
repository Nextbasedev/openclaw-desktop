"use client"

import { Separator } from "@/components/ui/separator"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  BookOpen01Icon,
  DiscordIcon,
  GithubIcon,
  CommandIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons"
import { APP_VERSION, APP_NAME } from "../../config"

type HelpItem = {
  label: string
  description: string
  url: string
  icon: typeof BookOpen01Icon
}

const HELP_ITEMS: HelpItem[] = [
  {
    label: "Documentation",
    description: "Read the official OpenClaw docs",
    url: "https://docs.openclaw.ai",
    icon: BookOpen01Icon,
  },
  {
    label: "Community Discord",
    description: "Join the community for help and discussion",
    url: "https://discord.com/invite/clawd",
    icon: DiscordIcon,
  },
  {
    label: "GitHub",
    description: "Report issues and view source code",
    url: "https://github.com/openclaw/openclaw",
    icon: GithubIcon,
  },
  {
    label: "Keyboard Shortcuts",
    description: "View all keyboard shortcuts",
    url: "#",
    icon: CommandIcon,
  },
]

export function HelpTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Help</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resources, documentation, and support for OpenClaw Desktop.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {HELP_ITEMS.map((item) => (
          <a
            key={item.label}
            href={item.url}
            target={item.url.startsWith("http") ? "_blank" : undefined}
            rel={item.url.startsWith("http") ? "noopener noreferrer" : undefined}
            className="group flex items-center gap-4 rounded-xl border border-border/50 bg-muted/20 p-4 transition-all hover:bg-muted/40 hover:border-border"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
              <HugeiconsIcon icon={item.icon} size={20} strokeWidth={1.5} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                {item.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {item.description}
              </span>
            </div>
            {item.url.startsWith("http") && (
              <svg
                className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
                />
              </svg>
            )}
          </a>
        ))}
      </div>

      <Separator className="bg-border/50" />

      <div className="flex items-center gap-3 rounded-lg bg-muted/20 p-4">
        <HugeiconsIcon
          icon={InformationCircleIcon}
          size={16}
          strokeWidth={1.5}
          className="text-muted-foreground shrink-0"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {APP_NAME}
          </span>
          <span className="text-xs text-muted-foreground">
            Version {APP_VERSION} · Built with Tauri + Next.js
          </span>
        </div>
      </div>
    </div>
  )
}
