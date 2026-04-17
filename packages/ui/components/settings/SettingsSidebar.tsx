"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { SETTINGS_TABS, type SettingsTabId } from "./settings.config"

type SettingsSidebarProps = {
  activeTab: SettingsTabId
  onTabChange: (tab: SettingsTabId) => void
}

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const mainTabs = SETTINGS_TABS.filter((t) => t.group === "main")
  const footerTabs = SETTINGS_TABS.filter((t) => t.group === "footer")

  return (
    <nav className="flex w-[200px] shrink-0 flex-col border-r border-border/50 py-4">
      {/* Main tabs */}
      <div className="flex flex-col gap-0.5 px-3">
        {mainTabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <HugeiconsIcon
                icon={tab.icon}
                size={16}
                strokeWidth={isActive ? 2 : 1.5}
              />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer tabs */}
      <div className="flex flex-col gap-0.5 px-3">
        {footerTabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <HugeiconsIcon
                icon={tab.icon}
                size={16}
                strokeWidth={isActive ? 2 : 1.5}
              />
              {tab.label}
              {tab.external && (
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  size={12}
                  strokeWidth={1.5}
                  className="ml-auto text-muted-foreground"
                />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
