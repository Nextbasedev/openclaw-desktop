"use client"

import { useAtom } from "jotai"
import {
  settingsOpenAtom,
  settingsTabAtom,
  confirmActionAtom,
} from "../../store/atoms"
import type { SettingsTab } from "../../types"

export function useSettings() {
  const [isOpen, setIsOpen] = useAtom(settingsOpenAtom)
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom)
  const [confirmAction, setConfirmAction] = useAtom(confirmActionAtom)

  function open(tab?: SettingsTab) {
    if (tab) setActiveTab(tab)
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
    setConfirmAction(null)
  }

  function selectTab(tab: SettingsTab) {
    setActiveTab(tab)
    setConfirmAction(null)
  }

  return {
    isOpen,
    activeTab,
    confirmAction,
    open,
    close,
    selectTab,
    setConfirmAction,
  }
}
