"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { HelpTab } from "./tabs/HelpTab"
import { KeyboardShortcutsTab } from "./tabs/KeyboardShortcutsTab"
import { ArchiveTab } from "./tabs/ArchiveTab"
import { ConfigTab } from "./tabs/ConfigTab"
import { UsageTab } from "./tabs/UsageTab"
import { VoiceTab } from "./tabs/VoiceTab"
import { cn } from "@/lib/utils"

type SettingSection = "usage" | "config" | "archive" | "appearance" | "voice" | "help" | "shortcuts"

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
      { id: "archive", label: "Archive", icon: Icons.File },
    ],
  },
  {
    label: "System",
    items: [
      { id: "appearance", label: "Appearance", icon: Icons.Settings },
      { id: "voice", label: "Voice", icon: Icons.Automations },
    ],
  },
]

const FOOTER_ITEMS: Array<{ id: SettingSection; label: string; icon: React.ElementType }> = [
  { id: "help", label: "Help", icon: Icons.Help },
]

type SettingsDashboardProps = {
  onBack?: () => void
  initialSection?: SettingSection
}

export function SettingsDashboard({ onBack, initialSection = "usage" }: SettingsDashboardProps) {
  const [activeSection, setActiveSection] = React.useState<SettingSection>(initialSection)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const topNavItems = [...SECTION_GROUPS.flatMap((group) => group.items), ...FOOTER_ITEMS]
  const resolvedSection = topNavItems.some((item) => item.id === activeSection)
    ? activeSection
    : "usage"

  React.useEffect(() => {
    setActiveSection(initialSection)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [initialSection])

  function handleSidebarClick(id: SettingSection) {
    setActiveSection(id)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col items-center px-2 pt-6 min-[720px]:px-3 min-[720px]:pt-8 lg:pt-10">
      <nav className="w-full max-w-2xl px-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="group mb-4 flex cursor-pointer items-center gap-2 rounded-md text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icons.Back size={14} className="transition-transform group-hover:-translate-x-0.5" />
            <span>Back</span>
          </button>
        )}

        <div className="flex flex-wrap gap-2 pb-2">
          {topNavItems.map((item) => (
            <TopNavButton
              key={item.id}
              item={item}
              isActive={activeSection === item.id}
              onClick={() => handleSidebarClick(item.id)}
            />
          ))}
        </div>
      </nav>

      <div
        ref={scrollRef}
        className="my-2 mx-2 min-h-0 flex-1 w-full max-w-2xl overflow-y-auto scrollbar-hide md:my-4 lg:my-6"
      >
        {resolvedSection === "usage" && <UsageTab />}

        {resolvedSection === "config" && <ConfigTab />}

        {resolvedSection === "archive" && <ArchiveTab />}

        {resolvedSection === "appearance" && <AppearanceTab />}

        {resolvedSection === "voice" && <VoiceTab />}

        {resolvedSection === "help" && <HelpTab onShortcutsClick={() => { setActiveSection("shortcuts"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}

        {resolvedSection === "shortcuts" && <KeyboardShortcutsTab onBack={() => { setActiveSection("help"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}
      </div>
    </div>
  )
}

function TopNavButton({
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
        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-[14px] transition-colors",
        isActive
          ? "border-foreground/25 bg-foreground/5 text-foreground"
          : "border-border/50 text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  )
}
