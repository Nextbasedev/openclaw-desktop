"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { AppearanceTab } from "./tabs/AppearanceTab"
import { HelpTab } from "./tabs/HelpTab"
import { KeyboardShortcutsTab } from "./tabs/KeyboardShortcutsTab"
import { ConfigTab } from "./tabs/ConfigTab"
import { UsageTab } from "./tabs/UsageTab"
import { VoiceTab } from "./tabs/VoiceTab"
import ConnectPage from "@/components/ConnectPage"
import { cn } from "@/lib/utils"

export type SettingSection = "usage" | "config" | "connect" | "appearance" | "voice" | "help" | "shortcuts"

type SectionGroup = {
  label: string
  items: Array<{ id: SettingSection; label: string; icon: React.ElementType }>
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Personal",
    items: [
      { id: "usage", label: "Usage", icon: Icons.Automations },
      { id: "config", label: "Config", icon: Icons.Settings },
      { id: "connect", label: "Connect", icon: Icons.Globe },
    ],
  },
  {
    label: "System",
    items: [
      { id: "appearance", label: "Appearance", icon: Icons.Settings },
      // Voice settings are intentionally hidden from the settings sidebar for now.
      // { id: "voice", label: "Voice", icon: Icons.Automations },
    ],
  },
]

const FOOTER_ITEMS: Array<{ id: SettingSection; label: string; icon: React.ElementType }> = [
  { id: "help", label: "Help", icon: Icons.Help },
]

type SettingsDashboardProps = {
  onBack?: () => void
  activeSection: SettingSection
  onSectionChange: (section: SettingSection) => void
}

export function SettingsDashboard({ onBack, activeSection, onSectionChange }: SettingsDashboardProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [isCompactSidebar, setIsCompactSidebar] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : false,
  )
  const [compactSidebarOpen, setCompactSidebarOpen] = React.useState(false)
  const topNavItems = SECTION_GROUPS.flatMap((group) => group.items)
  const allNavItems = [...topNavItems, ...FOOTER_ITEMS]
  const resolvedSection = allNavItems.some((item) => item.id === activeSection)
    ? activeSection
    : "usage"

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [activeSection])

  React.useEffect(() => {
    function updateCompactSidebar() {
      const compact = window.innerWidth < 1024
      setIsCompactSidebar(compact)
      if (!compact) setCompactSidebarOpen(false)
    }

    updateCompactSidebar()
    window.addEventListener("resize", updateCompactSidebar)
    return () => window.removeEventListener("resize", updateCompactSidebar)
  }, [])

  function handleSidebarClick(id: SettingSection) {
    onSectionChange(id)
    if (isCompactSidebar) {
      setCompactSidebarOpen(false)
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement) activeElement.blur()
    }
  }

  return (
    <div
      className="relative flex h-full w-full min-w-0 overflow-hidden bg-transparent max-lg:bg-background/70"
    >
      <aside
        onMouseEnter={() => isCompactSidebar && setCompactSidebarOpen(true)}
        onMouseLeave={() => isCompactSidebar && setCompactSidebarOpen(false)}
        className={cn(
          "group/settings-sidebar flex w-[220px] shrink-0 flex-col bg-black/[0.025] transition-[width,background-color,box-shadow] duration-300 ease-in-out dark:bg-white/[0.025]",
          isCompactSidebar && "absolute inset-y-0 left-0 z-30 w-14 overflow-hidden border-r border-border/60 bg-background/95 shadow-[12px_0_32px_rgba(0,0,0,0.22)] backdrop-blur-xl",
          isCompactSidebar && compactSidebarOpen && "w-[236px] max-sm:w-[204px] max-[360px]:w-[188px]",
        )}
      >
        <div className="px-4 py-4 max-lg:px-2 max-lg:py-3">
          <div className="mb-3 flex items-center gap-2 max-lg:mb-2">
            <button
              type="button"
              onClick={() => setCompactSidebarOpen((open) => !open)}
              aria-label={compactSidebarOpen ? "Close settings sidebar" : "Open settings sidebar"}
              className="hidden size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045] max-lg:flex"
            >
              {compactSidebarOpen ? <Icons.Close size={16} /> : <Icons.SidebarToggle size={16} />}
            </button>

            {onBack ? (
              <button
                onClick={onBack}
                aria-label="Back"
                className={cn(
                  "group flex h-7 cursor-pointer items-center gap-2 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:flex",
                  isCompactSidebar && !compactSidebarOpen && "hidden",
                  isCompactSidebar && compactSidebarOpen && "flex h-10 min-w-0 px-2",
                )}
              >
                <Icons.Back size={14} className="shrink-0 transition-transform group-hover:-translate-x-0.5" />
                <span className="truncate whitespace-nowrap">Back</span>
              </button>
            ) : null}
          </div>

          <div className={cn(
            "transition-[opacity,height,width] duration-200 pl-2 sm:pl-0",
            isCompactSidebar && !compactSidebarOpen && "h-0 w-0 overflow-hidden opacity-0",
            isCompactSidebar && compactSidebarOpen && "h-auto w-auto opacity-100",
          )}>
            <p className="whitespace-nowrap text-[15px] font-semibold text-foreground">Settings</p>
            <p className="mt-1 whitespace-nowrap text-[12px] text-muted-foreground">Manage OpenClaw</p>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col px-3 py-3 max-lg:px-2 max-lg:py-2">
          <div className="space-y-5 max-lg:space-y-2">
            {SECTION_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1 max-lg:space-y-1.5">
                <p className={cn(
                  "px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 transition-[opacity,height,padding,width] duration-200",
                  isCompactSidebar && !compactSidebarOpen && "h-0 w-0 overflow-hidden p-0 whitespace-nowrap opacity-0",
                  isCompactSidebar && compactSidebarOpen && "h-auto w-auto px-2 pb-1 opacity-100",
                )}>
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <SettingsNavButton
                    key={item.id}
                    item={item}
                    isActive={resolvedSection === item.id}
                    onClick={() => handleSidebarClick(item.id)}
                    expanded={!isCompactSidebar || compactSidebarOpen}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-auto pt-3">
            {FOOTER_ITEMS.map((item) => (
              <SettingsNavButton
                key={item.id}
                item={item}
                isActive={resolvedSection === item.id}
                onClick={() => handleSidebarClick(item.id)}
                expanded={!isCompactSidebar || compactSidebarOpen}
              />
            ))}
          </div>
        </nav>
      </aside>

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 scrollbar-hide max-lg:pl-14 max-[360px]:pl-12",
          resolvedSection === "config" ? "overflow-hidden bg-transparent" : "overflow-y-auto",
          resolvedSection === "connect" ? "bg-transparent" : resolvedSection === "config" ? "bg-transparent" : "bg-transparent px-8 py-7 max-lg:bg-background/35 max-lg:py-5 max-lg:pr-4 max-sm:pr-3 max-[360px]:pr-2",
        )}
      >
        <div className={cn("mx-auto min-h-full", resolvedSection === "config" && "h-full", resolvedSection === "connect" || resolvedSection === "config" ? "max-w-none" : "max-w-2xl")}>
          {resolvedSection === "usage" && <UsageTab />}

          {resolvedSection === "config" && <ConfigTab />}

          {resolvedSection === "connect" && <ConnectPage />}

          {resolvedSection === "appearance" && <AppearanceTab />}

          {resolvedSection === "voice" && <VoiceTab />}

          {resolvedSection === "help" && <HelpTab />}

          {resolvedSection === "shortcuts" && <KeyboardShortcutsTab onBack={() => { onSectionChange("help"); if (scrollRef.current) scrollRef.current.scrollTop = 0 }} />}
        </div>
      </div>
    </div>
  )
}

function SettingsNavButton({
  item,
  isActive,
  onClick,
  expanded = true,
}: {
  item: { id: string; label: string; icon: React.ElementType }
  isActive: boolean
  onClick: () => void
  expanded?: boolean
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
        !expanded && "mx-auto size-10 justify-center px-0 py-0",
        expanded && "justify-start px-2.5 py-2",
        "outline-none focus-visible:bg-black/[0.055] dark:focus-visible:bg-white/[0.06]",
        isActive
          ? "bg-black/[0.055] text-foreground dark:bg-white/[0.075]"
          : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      <span className={cn(
        "truncate transition-[opacity,width] duration-200",
        !expanded && "w-0 opacity-0",
        expanded && "w-auto opacity-100",
      )}>{item.label}</span>
    </button>
  )
}
