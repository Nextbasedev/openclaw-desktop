import type { IconSvgElement } from "@hugeicons/react"
import {
  UserAccountIcon,
  Settings02Icon,
  InformationCircleIcon,
  LinkSquare02Icon,
  Wrench01Icon,
  HelpCircleIcon,
  GridIcon,
  Download04Icon,
} from "@hugeicons/core-free-icons"

/* ── Tab Types ── */

export type SettingsTabId =
  | "account"
  | "personalization"
  | "models"
  | "providers"
  | "data-control"
  | "maintenance"
  | "help"
  | "affiliate"

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
  { id: "personalization", label: "Personalization", icon: Settings02Icon, group: "main" },
  { id: "models", label: "Models", icon: InformationCircleIcon, group: "main" },
  { id: "providers", label: "Providers", icon: LinkSquare02Icon, group: "main" },
  { id: "data-control", label: "Data Control", icon: GridIcon, group: "main" },
  { id: "maintenance", label: "Maintenance", icon: Wrench01Icon, group: "main" },
  { id: "help", label: "Help", icon: HelpCircleIcon, group: "footer" },
  { id: "affiliate", label: "Affiliate", icon: Download04Icon, group: "footer", external: true },
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
