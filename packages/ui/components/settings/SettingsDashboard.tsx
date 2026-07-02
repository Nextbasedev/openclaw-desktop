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
      className="relative flex h-full w-full min-w-0 overflow-hidden bg-transparent max-lg:bg-background/70"
    >
      <aside className="group/settings-sidebar flex w-[220px] shrink-0 flex-col bg-black/[0.025] transition-[width,background-color,box-shadow] duration-300 ease-in-out dark:bg-white/[0.025] max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:w-14 max-lg:overflow-hidden max-lg:border-r max-lg:border-border/50 max-lg:bg-background/80 max-lg:shadow-lg max-lg:backdrop-blur-xl max-lg:hover:w-[220px] max-sm:hover:w-[188px] max-[360px]:hover:w-[176px] max-lg:focus-within:w-[220px] max-sm:focus-within:w-[188px] max-[360px]:focus-within:w-[176px]">
        <div className="px-4 py-4 max-lg:px-2">
          {onBack ? (
            <button
              onClick={onBack}
              aria-label="Back"
              className="group mb-3 flex h-7 cursor-pointer items-center gap-2 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground max-lg:w-full max-lg:justify-center max-lg:group-hover/settings-sidebar:justify-start max-lg:group-hover/settings-sidebar:px-2 max-lg:group-focus-within/settings-sidebar:justify-start max-lg:group-focus-within/settings-sidebar:px-2"
            >
              <Icons.Back size={14} className="shrink-0 transition-transform group-hover:-translate-x-0.5" />
              <span className="max-lg:w-0 max-lg:overflow-hidden max-lg:whitespace-nowrap max-lg:opacity-0 max-lg:transition-[opacity,width] max-lg:duration-200 max-lg:group-hover/settings-sidebar:w-auto max-lg:group-hover/settings-sidebar:opacity-100 max-lg:group-focus-within/settings-sidebar:w-auto max-lg:group-focus-within/settings-sidebar:opacity-100">Back</span>
            </button>
          ) : null}
          <div className="max-lg:w-0 max-lg:overflow-hidden max-lg:opacity-0 max-lg:transition-[opacity,width] max-lg:duration-200 max-lg:group-hover/settings-sidebar:w-auto max-lg:group-hover/settings-sidebar:opacity-100 max-lg:group-focus-within/settings-sidebar:w-auto max-lg:group-focus-within/settings-sidebar:opacity-100">
            <p className="whitespace-nowrap text-[15px] font-semibold text-foreground">Settings</p>
            <p className="mt-1 whitespace-nowrap text-[12px] text-muted-foreground">Manage OpenClaw</p>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col px-3 py-3 max-lg:px-2">
          <div className="space-y-5">
            {SECTION_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 max-lg:w-0 max-lg:overflow-hidden max-lg:whitespace-nowrap max-lg:opacity-0 max-lg:transition-[opacity,width] max-lg:duration-200 max-lg:group-hover/settings-sidebar:w-auto max-lg:group-hover/settings-sidebar:opacity-100 max-lg:group-focus-within/settings-sidebar:w-auto max-lg:group-focus-within/settings-sidebar:opacity-100">
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
          "min-h-0 flex-1 scrollbar-hide max-lg:pl-14 max-[360px]:pl-12",
          resolvedSection === "config" ? "overflow-hidden bg-transparent" : "overflow-y-auto",
          resolvedSection === "connect" ? "bg-transparent" : resolvedSection === "config" ? "bg-transparent" : "bg-transparent px-8 py-7 max-lg:bg-background/35 max-lg:py-5 max-lg:pr-4 max-sm:pr-3 max-[360px]:pr-2",
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
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors max-lg:justify-center max-lg:px-0 max-lg:group-hover/settings-sidebar:justify-start max-lg:group-hover/settings-sidebar:px-2.5 max-lg:group-focus-within/settings-sidebar:justify-start max-lg:group-focus-within/settings-sidebar:px-2.5",
        "outline-none focus-visible:bg-black/[0.055] dark:focus-visible:bg-white/[0.06]",
        isActive
          ? "bg-black/[0.055] text-foreground dark:bg-white/[0.075]"
          : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      <span className="truncate max-lg:w-0 max-lg:opacity-0 max-lg:transition-[opacity,width] max-lg:duration-200 max-lg:group-hover/settings-sidebar:w-auto max-lg:group-hover/settings-sidebar:opacity-100 max-lg:group-focus-within/settings-sidebar:w-auto max-lg:group-focus-within/settings-sidebar:opacity-100">{item.label}</span>
    </button>
  )
}
