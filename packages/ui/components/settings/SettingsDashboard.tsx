"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { AccountTab } from "./tabs/AccountTab"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { DataControlTab } from "./tabs/DataControlTab"
import { MaintenanceTab } from "./tabs/MaintenanceTab"
import { ProfilesTab } from "./tabs/ProfilesTab"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

type SettingSection = "overview" | "account" | "appearance" | "data" | "maintenance" | "profiles"

export function SettingsDashboard() {
  const [activeSection, setActiveSection] = React.useState<SettingSection>("overview")
  const router = useRouter()

  const sections = [
    {
      id: "account" as const,
      label: "Account",
      description: "Manage your profile, email, and identity settings.",
      icon: Icons.UserAccount,
      component: AccountTab,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      id: "appearance" as const,
      label: "Appearance",
      description: "Customize the theme, layout, and visual feel of Jarvis.",
      icon: Icons.Settings,
      component: AppearanceTab,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
    {
      id: "profiles" as const,
      label: "Profiles",
      description: "Manage environment connections and gateway endpoints.",
      icon: Icons.Grid,
      component: ProfilesTab,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      id: "data" as const,
      label: "Data Control",
      description: "Export conversations, memory, and sensitive agent data.",
      icon: Icons.Files,
      component: DataControlTab,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
    },
    {
      id: "maintenance" as const,
      label: "Maintenance",
      description: "Sign out, reset local storage, or delete your account.",
      icon: Icons.Wrench,
      component: MaintenanceTab,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
    },
  ]

  if (activeSection !== "overview") {
    const section = sections.find((s) => s.id === activeSection)
    if (!section) return null
    const Component = section.component

    return (
      <div className="w-full max-w-4xl px-8 py-10 animate-in fade-in slide-in-from-right-4 duration-300">
        <button
          onClick={() => setActiveSection("overview")}
          className="mb-8 flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground group cursor-pointer"
        >
          <Icons.Back size={16} className="transition-transform group-hover:-translate-x-0.5" />
          Back to System
        </button>

        <div className="rounded-3xl border border-border/40 bg-card/30 p-10 shadow-sm backdrop-blur-md">
          <Component />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl px-8 py-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-[36px] font-bold tracking-tight text-foreground">
            System Options
          </h1>
          <p className="text-muted-foreground mt-2 text-[16px]">
            Configure your core agent experience and desktop infrastructure.
          </p>
        </div>
        <button
          onClick={() => router.push("/connect")}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] cursor-pointer"
        >
          <Icons.Globe size={18} />
          Connect to Gateway
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={cn(
              "group relative flex flex-col items-start p-6 text-left transition-all duration-300",
              "rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm",
              "hover:border-primary/30 hover:bg-card/60 hover:shadow-xl hover:-translate-y-1 cursor-pointer"
            )}
          >
            <div className={cn("mb-4 flex size-12 items-center justify-center rounded-xl", section.bg, section.color)}>
              <section.icon size={24} strokeWidth={1.5} />
            </div>

            <div className="space-y-1.5 rounded-lg">
              <h3 className="text-[17px] font-semibold text-foreground group-hover:text-primary transition-colors">
                {section.label}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground/80">
                {section.description}
              </p>
            </div>

            <div className="absolute bottom-6 right-6 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1">
              <Icons.ExternalLink size={16} className="text-muted-foreground" />
            </div>
          </button>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-dashed border-border/50 p-8 text-center bg-muted/5">
        <div className="inline-flex size-10 items-center justify-center rounded-full bg-secondary/50 text-muted-foreground mb-3">
          <Icons.Help size={20} />
        </div>
        <p className="text-[14px] text-muted-foreground">
          Need more help? Check out our <span className="text-primary cursor-pointer hover:underline">Documentation</span> or join the <span className="text-primary cursor-pointer hover:underline">Discord</span>.
        </p>
      </div>
    </div>
  )
}
