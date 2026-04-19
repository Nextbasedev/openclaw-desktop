"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { AccountTab } from "./tabs/AccountTab"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { DataControlTab } from "./tabs/DataControlTab"
import { MaintenanceTab } from "./tabs/MaintenanceTab"
import { HelpTab } from "./tabs/HelpTab"
import { KeyboardShortcutsTab } from "./tabs/KeyboardShortcutsTab"
import { ArchiveTab } from "./tabs/ArchiveTab"
// import { UsagePage } from "@/components/UsagePage"
import { cn } from "@/lib/utils"

type SettingSection = "usage" | "memory" | "archive" | "account" | "appearance" | "data" | "maintenance" | "help" | "shortcuts"

const SYSTEM_IDS: SettingSection[] = ["account", "appearance", "data", "maintenance"]

type SectionGroup = {
  label: string
  items: Array<{ id: SettingSection; label: string; icon: React.ElementType }>
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Personal",
    items: [
      { id: "usage", label: "Usage", icon: Icons.Automations },
      { id: "memory", label: "Memory", icon: Icons.Memory },
      { id: "archive", label: "Archive", icon: Icons.File },
    ],
  },
  {
    label: "System",
    items: [
      { id: "account", label: "Account", icon: Icons.UserAccount },
      { id: "appearance", label: "Appearance", icon: Icons.Settings },
      { id: "data", label: "Data Control", icon: Icons.Files },
      { id: "maintenance", label: "Maintenance", icon: Icons.Wrench },
    ],
  },
]

const FOOTER_ITEMS: Array<{ id: SettingSection; label: string; icon: React.ElementType }> = [
  { id: "help", label: "Help", icon: Icons.Help },
]

type SettingsDashboardProps = {
  onSignOut?: () => void
  onDeleteAccount?: () => void
  accountData?: { botName: string; provider: string; model: string }
  onBack?: () => void
}

export function SettingsDashboard({ onSignOut, onDeleteAccount, accountData, onBack }: SettingsDashboardProps) {
  const [activeSection, setActiveSection] = React.useState<SettingSection>("usage")
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const sectionRefs = React.useRef<Record<string, HTMLElement | null>>({})
  const isClickScroll = React.useRef(false)

  const activeView = SYSTEM_IDS.includes(activeSection) ? "system" : activeSection

  React.useEffect(() => {
    const container = scrollRef.current
    if (!container || activeView !== "system") return

    function onScroll() {
      if (isClickScroll.current) return
      const top = container!.getBoundingClientRect().top
      let closest: SettingSection = "account"
      let closestDist = Infinity
      for (const id of SYSTEM_IDS) {
        const el = sectionRefs.current[id]
        if (!el) continue
        const dist = Math.abs(el.getBoundingClientRect().top - top)
        if (dist < closestDist) {
          closestDist = dist
          closest = id
        }
      }
      setActiveSection(closest)
    }

    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [activeView])

  function handleSidebarClick(id: SettingSection) {
    if (SYSTEM_IDS.includes(id) && activeView === "system") {
      const el = sectionRefs.current[id]
      if (el) {
        isClickScroll.current = true
        el.scrollIntoView({ behavior: "smooth", block: "start" })
        setActiveSection(id)
        setTimeout(() => { isClickScroll.current = false }, 600)
      }
    } else {
      setActiveSection(id)
      if (scrollRef.current) scrollRef.current.scrollTop = 0
    }
  }

  return (
    <div className="flex h-full w-full justify-center gap-15 pt-10">
      <nav className="flex w-[180px] shrink-0 flex-col px-3 py-6">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-4 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground group"
          >
            <Icons.Back size={14} className="transition-transform group-hover:-translate-x-0.5" />
            Back
          </button>
        )}

        {SECTION_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SidebarButton
                  key={item.id}
                  item={item}
                  isActive={activeSection === item.id}
                  onClick={() => handleSidebarClick(item.id)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="mt-auto pt-3">
          {FOOTER_ITEMS.map((item) => (
            <SidebarButton
              key={item.id}
              item={item}
              isActive={activeSection === item.id}
              onClick={() => handleSidebarClick(item.id)}
            />
          ))}
        </div>
      </nav>

      <div ref={scrollRef} className="w-full max-w-xl overflow-y-auto scrollbar-hide my-10 md:my-14 lg:my-18">
        {/* {activeView === "usage" && <UsagePage />} */}
        {activeView === "usage" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Usage</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Track your token consumption and costs.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Usage data will appear here once you have an active subscription connected.
              </p>
            </div>
          </div>
        )}

        {activeView === "memory" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Memory</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                View and manage your agent&apos;s stored memory and context.
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-5 text-sm text-muted-foreground italic">
              Memory system is loading...
            </div>
          </div>
        )}

        {activeView === "archive" && <ArchiveTab />}

        {activeView === "system" && (
          <div className="flex flex-col gap-12">
            <div ref={(el) => { sectionRefs.current.account = el }}>
              <AccountTab data={accountData} />
            </div>
            <div ref={(el) => { sectionRefs.current.appearance = el }}>
              <AppearanceTab />
            </div>
            <div ref={(el) => { sectionRefs.current.data = el }}>
              <DataControlTab />
            </div>
            <div ref={(el) => { sectionRefs.current.maintenance = el }}>
              <MaintenanceTab onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />
            </div>
          </div>
        )}

        {activeView === "help" && <HelpTab onShortcutsClick={() => { setActiveSection("shortcuts"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}

        {activeView === "shortcuts" && <KeyboardShortcutsTab onBack={() => { setActiveSection("help"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}
      </div>
    </div>
  )
}

function SidebarButton({
  item,
  isActive,
  onClick,
}: {
  item: { id: string; label: string; icon: React.ElementType }
  isActive: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition-colors",
        isActive
          ? "bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      {item.label}
    </button>
  )
}
