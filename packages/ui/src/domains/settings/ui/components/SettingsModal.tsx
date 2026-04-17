"use client"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  UserAccountIcon,
  PaintBrush01Icon,
  Wrench01Icon,
  HelpCircleIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { useSettings } from "../hooks/useSettings"
import { SETTINGS_TABS } from "../../config"
import type { SettingsTab } from "../../types"
import { AccountTab } from "./AccountTab"
import { AppearanceTab } from "./AppearanceTab"
import { MaintenanceTab } from "./MaintenanceTab"
import { HelpTab } from "./HelpTab"

const TAB_ICONS: Record<SettingsTab, typeof UserAccountIcon> = {
  account: UserAccountIcon,
  appearance: PaintBrush01Icon,
  maintenance: Wrench01Icon,
  help: HelpCircleIcon,
}

const TAB_COMPONENTS: Record<SettingsTab, React.FC> = {
  account: AccountTab,
  appearance: AppearanceTab,
  maintenance: MaintenanceTab,
  help: HelpTab,
}

export function SettingsModal() {
  const { isOpen, activeTab, close, selectTab } = useSettings()
  const ActiveTabComponent = TAB_COMPONENTS[activeTab]

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton
        className={cn(
          "sm:max-w-2xl lg:max-w-3xl h-[min(600px,80vh)]",
          "p-0 gap-0 overflow-hidden",
          // Glassmorphism
          "bg-background/80 backdrop-blur-2xl backdrop-saturate-150",
          "border border-border/40",
          "shadow-2xl shadow-black/20",
          "dark:bg-background/70 dark:border-white/[0.08]",
          "dark:shadow-black/50",
        )}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <div className="flex h-full">
          {/* Sidebar */}
          <nav
            className={cn(
              "flex w-[200px] shrink-0 flex-col border-r",
              "border-border/30 bg-muted/20",
              "dark:border-white/[0.06] dark:bg-white/[0.02]",
            )}
          >
            <div className="p-5 pb-3">
              <h2 className="text-base font-semibold text-foreground">
                Settings
              </h2>
            </div>

            <div className="flex flex-1 flex-col gap-1 px-3 pb-3">
              {SETTINGS_TABS.map((tab) => {
                const Icon = TAB_ICONS[tab.id]
                const isActive = activeTab === tab.id

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-primary text-primary-foreground font-medium shadow-sm"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <HugeiconsIcon
                      icon={Icon}
                      size={18}
                      strokeWidth={isActive ? 2 : 1.5}
                    />
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </nav>

          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-6 pr-8">
              <ActiveTabComponent />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
