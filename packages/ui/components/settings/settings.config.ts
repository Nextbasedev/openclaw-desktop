import type { IconSvgElement } from "@hugeicons/react"
import {
  UserAccountIcon,
  Settings02Icon,
  Wrench01Icon,
  HelpCircleIcon,
  GridIcon,
} from "@hugeicons/core-free-icons"

/* ── Tab Types ── */

export type SettingsTabId =
  | "account"
  | "personalization"
  | "data-control"
  | "maintenance"
  | "help"

export type SettingsTabItem = {
  id: SettingsTabId
  label: string
  icon: IconSvgElement
  group: "main" | "footer"
  external?: boolean
}

/* ── Tab Config (single source of truth) ── */

export const SETTINGS_TABS: SettingsTabItem[] = [
  { id: "account", label: "Account", icon: UserAccountIcon, group: "main" },
  { id: "personalization", label: "Appearance", icon: Settings02Icon, group: "main" },
  { id: "data-control", label: "Data Control", icon: GridIcon, group: "main" },
  { id: "maintenance", label: "Maintenance", icon: Wrench01Icon, group: "main" },
  { id: "help", label: "Help", icon: HelpCircleIcon, group: "footer" },
]

/* ── Data Control Export Items ── */

export type ExportItem = {
  id: string
  title: string
  description: string
  icon: IconSvgElement
}

/* ── Header Config ── */

export type HeaderUser = {
  name: string
  version: string
}
