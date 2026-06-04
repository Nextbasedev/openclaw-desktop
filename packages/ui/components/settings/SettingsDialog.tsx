"use client"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { SettingsDashboard, type SettingSection } from "./SettingsDashboard"

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeSection: SettingSection
  onSectionChange: (section: SettingSection) => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  activeSection,
  onSectionChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-2xl"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <SettingsDashboard
          onBack={() => onOpenChange(false)}
          activeSection={activeSection}
          onSectionChange={onSectionChange}
        />
      </DialogContent>
    </Dialog>
  )
}
