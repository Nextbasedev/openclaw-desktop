/** Settings store — Jotai atoms for settings state */

import { atom } from "jotai"
import type { SettingsTab, UserProfile, AppearanceSettings } from "../types"
import { DEFAULT_APPEARANCE } from "../config"

/** Whether the settings dialog is open */
export const settingsOpenAtom = atom(false)

/** Currently active settings tab */
export const settingsTabAtom = atom<SettingsTab>("account")

/** User profile data */
export const userProfileAtom = atom<UserProfile>({
  name: "",
  email: "",
  avatarUrl: null,
  authProvider: null,
})

/** Appearance settings */
export const appearanceSettingsAtom = atom<AppearanceSettings>(DEFAULT_APPEARANCE)

/** Whether a destructive action confirmation is pending */
export const confirmActionAtom = atom<"sign-out" | "delete-account" | null>(null)
