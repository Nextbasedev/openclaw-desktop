"use client"

import { createContext, useContext, useCallback } from "react"
import { useAtom } from "jotai"
import {
  settingsOpenAtom,
  settingsTabAtom,
} from "@/src/domains/settings/store/atoms"

type SettingsTab = "account" | "appearance" | "maintenance" | "help"

type SettingsContextValue = {
  isOpen: boolean
  open: (tab?: SettingsTab) => void
  close: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useAtom(settingsOpenAtom)
  const [, setActiveTab] = useAtom(settingsTabAtom)

  const open = useCallback(
    (tab?: SettingsTab) => {
      if (tab) setActiveTab(tab)
      setIsOpen(true)
    },
    [setIsOpen, setActiveTab]
  )

  const close = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  return (
    <SettingsContext.Provider value={{ isOpen, open, close }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettingsProvider() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error("useSettingsProvider must be used within SettingsProvider")
  }
  return context
}
