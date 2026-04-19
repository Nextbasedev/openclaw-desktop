"use client"

import { openExternalUrl } from "@/lib/tauri"
import { LuBookOpen, LuUsers, LuGithub, LuKeyboard, LuExternalLink } from "react-icons/lu"

type HelpLink = {
  label: string
  description: string
  url: string
  icon: React.ElementType
}

const HELP_LINKS: HelpLink[] = [
  { label: "Documentation", description: "Read the official OpenClaw docs", url: "https://docs.openclaw.ai", icon: LuBookOpen },
  { label: "Community Discord", description: "Join the community", url: "https://discord.com/invite/clawd", icon: LuUsers },
  { label: "GitHub", description: "Report issues and view source", url: "https://github.com/nextbaseparadox-star/openclaw-desktop", icon: LuGithub },
  { label: "Keyboard Shortcuts", description: "View all shortcuts", url: "#", icon: LuKeyboard },
]

type HelpTabProps = {
  links?: HelpLink[]
  onShortcutsClick?: () => void
}

export function HelpTab({ links = HELP_LINKS, onShortcutsClick }: HelpTabProps) {
  function handleClick(link: HelpLink) {
    if (link.label === "Keyboard Shortcuts" && onShortcutsClick) {
      onShortcutsClick()
      return
    }
    if (link.url === "#") return
    openExternalUrl(link.url).catch(() => {
      window.open(link.url, "_blank")
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Help</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resources and support for OpenClaw Desktop.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        {links.map((link, idx) => {
          const Icon = link.icon
          const isExternal = link.url.startsWith("http")
          return (
            <button
              key={link.label}
              type="button"
              onClick={() => handleClick(link)}
              className={`flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/20 ${idx > 0 ? "border-t border-border/30" : ""}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                <Icon size={15} />
              </span>
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-foreground">{link.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{link.description}</span>
              </div>
              {isExternal && (
                <span className="text-muted-foreground/50">
                  <LuExternalLink size={14} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
