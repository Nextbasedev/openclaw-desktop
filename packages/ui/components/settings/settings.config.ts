import { Icons } from "@/components/icons"

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
  Icon: React.ElementType
  group: "main" | "footer"
  external?: boolean
}

/* ── Tab Config (single source of truth) ── */

export const SETTINGS_TABS: SettingsTabItem[] = [
  { id: "account", label: "Account", Icon: Icons.UserAccount, group: "main" },
  { id: "personalization", label: "Appearance", Icon: Icons.Settings, group: "main" },
  { id: "data-control", label: "Data Control", Icon: Icons.Grid, group: "main" },
  { id: "maintenance", label: "Maintenance", Icon: Icons.Wrench, group: "main" },
  { id: "help", label: "Help", Icon: Icons.Help, group: "footer" },
]


/* ── Data Control Export Items ── */

export type ExportItem = {
  id: string
  title: string
  description: string
  icon: React.ElementType
}

/* ── Header Config ── */

export type HeaderUser = {
  name: string
}
