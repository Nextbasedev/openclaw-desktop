/** Settings domain config — constants and defaults */

import type { SettingsTab, HelpLink, AppearanceSettings } from "../types"

export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "maintenance", label: "Maintenance" },
  { id: "help", label: "Help" },
] as const

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system",
  fontSize: "medium",
  reducedMotion: false,
}

export const HELP_LINKS: readonly HelpLink[] = [
  {
    label: "Documentation",
    url: "https://docs.openclaw.ai",
    description: "Read the official OpenClaw docs",
  },
  {
    label: "Community Discord",
    url: "https://discord.com/invite/clawd",
    description: "Join the community for help and discussion",
  },
  {
    label: "GitHub",
    url: "https://github.com/openclaw/openclaw",
    description: "Report issues and view source code",
  },
  {
    label: "Keyboard Shortcuts",
    url: "#",
    description: "View all keyboard shortcuts",
  },
] as const

export const APP_VERSION = "0.1.0"
export const APP_NAME = "OpenClaw Desktop"
