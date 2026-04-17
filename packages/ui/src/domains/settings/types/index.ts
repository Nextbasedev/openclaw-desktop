/** Settings domain types — pure declarations, no runtime imports */

export type SettingsTab =
  | "account"
  | "appearance"
  | "maintenance"
  | "help"

export type UserProfile = {
  name: string
  email: string
  avatarUrl: string | null
  authProvider: "google" | "github" | "email" | null
}

export type AppearanceTheme = "light" | "dark" | "system"

export type AppearanceSettings = {
  theme: AppearanceTheme
  fontSize: "small" | "medium" | "large"
  reducedMotion: boolean
}

export type MaintenanceAction = "sign-out" | "delete-account"

export type HelpLink = {
  label: string
  url: string
  description: string
}
