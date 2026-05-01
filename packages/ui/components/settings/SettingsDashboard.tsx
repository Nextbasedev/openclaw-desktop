"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { HelpTab } from "./tabs/HelpTab"
import { KeyboardShortcutsTab } from "./tabs/KeyboardShortcutsTab"
import { ArchiveTab } from "./tabs/ArchiveTab"
import { MemoryTab } from "./tabs/MemoryTab"
import { UsageTab } from "./tabs/UsageTab"
import { cn } from "@/lib/utils"

type SettingSection = "usage" | "memory" | "archive" | "appearance" | "help" | "shortcuts"

type SectionGroup = {
  label: string
  items: Array<{ id: SettingSection; label: string; icon: React.ElementType }>
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Personal",
    items: [
      { id: "usage", label: "Usage", icon: Icons.Automations },
      { id: "memory", label: "Memory", icon: Icons.Memory },
      { id: "archive", label: "Archive", icon: Icons.File },
    ],
  },
  {
    label: "System",
    items: [
      { id: "appearance", label: "Appearance", icon: Icons.Settings },
    ],
  },
]

const FOOTER_ITEMS: Array<{ id: SettingSection; label: string; icon: React.ElementType }> = [
  { id: "help", label: "Help", icon: Icons.Help },
]

type SettingsDashboardProps = {
  onBack?: () => void
}

export function SettingsDashboard({ onBack }: SettingsDashboardProps) {
  const [activeSection, setActiveSection] = React.useState<SettingSection>("memory")
  const scrollRef = React.useRef<HTMLDivElement>(null)

  function handleSidebarClick(id: SettingSection) {
    setActiveSection(id)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  return (
    <div className="flex h-full w-full justify-center gap-15 pt-10">
      <nav className="flex w-[180px] shrink-0 flex-col px-3 py-6">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-4 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground group"
          >
            <Icons.Back size={14} className="transition-transform group-hover:-translate-x-0.5" />
            Back
          </button>
        )}

        {SECTION_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SidebarButton
                  key={item.id}
                  item={item}
                  isActive={activeSection === item.id}
                  onClick={() => handleSidebarClick(item.id)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="mt-auto pt-3">
          {FOOTER_ITEMS.map((item) => (
            <SidebarButton
              key={item.id}
              item={item}
              isActive={activeSection === item.id}
              onClick={() => handleSidebarClick(item.id)}
            />
          ))}
        </div>
      </nav>

      <div ref={scrollRef} className="w-full max-w-xl overflow-y-auto scrollbar-hide my-2 md:my-4 lg:my-6">
        {activeSection === "usage" && <UsageTab />}

        {activeSection === "memory" && <MemoryTab />}

        {activeSection === "archive" && <ArchiveTab />}

        {activeSection === "appearance" && <AppearanceTab />}

        {activeSection === "help" && <HelpTab onShortcutsClick={() => { setActiveSection("shortcuts"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}

        {activeSection === "shortcuts" && <KeyboardShortcutsTab onBack={() => { setActiveSection("help"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}
      </div>
    </div>
  )
}

function SidebarButton({
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
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition-colors",
        isActive
          ? "bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      {item.label}
    </button>
  )
}
