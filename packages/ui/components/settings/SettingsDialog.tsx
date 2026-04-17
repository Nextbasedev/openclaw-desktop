"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SettingsSidebar } from "./SettingsSidebar"
import { AccountTab } from "./tabs/AccountTab"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { DataControlTab } from "./tabs/DataControlTab"
import { MaintenanceTab } from "./tabs/MaintenanceTab"
import { HelpTab } from "./tabs/HelpTab"
import { PlaceholderTab } from "./tabs/PlaceholderTab"
import type { SettingsTabId } from "./settings.config"

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: SettingsTabId
}

export function SettingsDialog({
  open,
  onOpenChange,
  defaultTab = "account",
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(defaultTab)

  const handleTabChange = useCallback((tab: SettingsTabId) => {
    if (tab === "affiliate") {
      window.open("https://openclaw.ai/affiliate", "_blank")
      return
    }
    setActiveTab(tab)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="sm:max-w-[700px] lg:max-w-[780px] h-[min(560px,85vh)] p-0 gap-0 overflow-hidden bg-popover border-border/50"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <div className="flex h-full">
          <SettingsSidebar activeTab={activeTab} onTabChange={handleTabChange} />

          <ScrollArea className="flex-1">
            <div className="p-6">
              <TabContent tab={activeTab} />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabContent({ tab }: { tab: SettingsTabId }) {
  switch (tab) {
    case "account":
      return <AccountTab />
    case "personalization":
      return <AppearanceTab />
    case "data-control":
      return <DataControlTab />
    case "maintenance":
      return <MaintenanceTab />
    case "help":
      return <HelpTab />
    case "models":
      return <PlaceholderTab title="Models" description="Manage AI model configurations." />
    case "providers":
      return <PlaceholderTab title="Providers" description="Configure API providers and connections." />
    default:
      return null
  }
}
