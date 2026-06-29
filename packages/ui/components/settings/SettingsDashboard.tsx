"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { HelpTab } from "./tabs/HelpTab"
import { KeyboardShortcutsTab } from "./tabs/KeyboardShortcutsTab"
import { ConfigTab } from "./tabs/ConfigTab"
import { UsageTab } from "./tabs/UsageTab"
import { VoiceTab } from "./tabs/VoiceTab"
import ConnectPage from "@/components/ConnectPage"
import { cn } from "@/lib/utils"

export type SettingSection = "usage" | "config" | "connect" | "appearance" | "voice" | "help" | "shortcuts"

type SectionGroup = {
  label: string
  items: Array<{ id: SettingSection; label: string; icon: React.ElementType }>
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Personal",
    items: [
      { id: "usage", label: "Usage", icon: Icons.Automations },
      { id: "config", label: "Config", icon: Icons.Settings },
      { id: "connect", label: "Connect", icon: Icons.Globe },
    ],
  },
  {
    label: "System",
    items: [
      { id: "appearance", label: "Appearance", icon: Icons.Settings },
      // Voice settings are intentionally hidden from the settings sidebar for now.
      // { id: "voice", label: "Voice", icon: Icons.Automations },
    ],
  },
]

const FOOTER_ITEMS: Array<{ id: SettingSection; label: string; icon: React.ElementType }> = [
  { id: "help", label: "Help", icon: Icons.Help },
]

type SettingsDashboardProps = {
  onBack?: () => void
  activeSection: SettingSection
  onSectionChange: (section: SettingSection) => void
}

export function SettingsDashboard({ onBack, activeSection, onSectionChange }: SettingsDashboardProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const topNavItems = SECTION_GROUPS.flatMap((group) => group.items)
  const allNavItems = [...topNavItems, ...FOOTER_ITEMS]
  const resolvedSection = allNavItems.some((item) => item.id === activeSection)
    ? activeSection
    : "usage"

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [activeSection])

  function handleSidebarClick(id: SettingSection) {
    onSectionChange(id)
  }

  return (
    <div
      className="flex h-full w-full min-w-0 overflow-hidden bg-transparent"
    >
      <aside className="flex w-[220px] shrink-0 flex-col bg-black/[0.025] dark:bg-white/[0.025]">
        <div className="px-4 py-4">
          {onBack ? (
            <button
              onClick={onBack}
              aria-label="Back"
              className="group mb-3 flex cursor-pointer items-center gap-2 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icons.Back size={14} className="transition-transform group-hover:-translate-x-0.5" />
              <span>Back</span>
            </button>
          ) : null}
          <div>
            <p className="text-[15px] font-semibold text-foreground">Settings</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Manage OpenClaw</p>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col px-3 py-3">
          <div className="space-y-5">
            {SECTION_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <SettingsNavButton
                    key={item.id}
                    item={item}
                    isActive={resolvedSection === item.id}
                    onClick={() => handleSidebarClick(item.id)}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-auto pt-3">
            {FOOTER_ITEMS.map((item) => (
              <SettingsNavButton
                key={item.id}
                item={item}
                isActive={resolvedSection === item.id}
                onClick={() => handleSidebarClick(item.id)}
              />
            ))}
          </div>
        </nav>
      </aside>

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 scrollbar-hide",
          resolvedSection === "config" ? "overflow-hidden bg-transparent" : "overflow-y-auto",
          resolvedSection === "connect" ? "bg-transparent" : resolvedSection === "config" ? "bg-transparent" : "bg-transparent px-8 py-7",
        )}
      >
        <div className={cn("mx-auto min-h-full", resolvedSection === "config" && "h-full", resolvedSection === "connect" || resolvedSection === "config" ? "max-w-none" : "max-w-2xl")}>
          {resolvedSection === "usage" && <UsageTab />}

          {resolvedSection === "config" && <ConfigTab />}

          {resolvedSection === "connect" && <ConnectPage />}

          {resolvedSection === "appearance" && <AppearanceTab />}

          {resolvedSection === "voice" && <VoiceTab />}

          {resolvedSection === "help" && <HelpTab />}

          {resolvedSection === "shortcuts" && <KeyboardShortcutsTab onBack={() => { onSectionChange("help"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}
        </div>
      </div>
    </div>
  )
}

function SettingsNavButton({
  item,
  isActive,
  onClick,
}: {
  item: { id: string; label: string; icon: React.ElementType }
  isActive: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
        "outline-none focus-visible:bg-black/[0.055] dark:focus-visible:bg-white/[0.06]",
        isActive
          ? "bg-black/[0.055] text-foreground dark:bg-white/[0.075]"
          : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  )
}
