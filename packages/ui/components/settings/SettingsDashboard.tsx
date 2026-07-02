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
          "group/settings-sidebar flex w-[220px] shrink-0 flex-col bg-black/[0.025] transition-[width,transform,opacity,background-color,box-shadow] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] dark:bg-white/[0.025] data-[open=true]:duration-300",
          isCompactSidebar && "absolute inset-y-0 left-0 z-30 w-14 overflow-hidden border-r border-border/60 bg-background/95 shadow-[12px_0_32px_rgba(0,0,0,0.22)] backdrop-blur-xl",
          isCompactSidebar && compactSidebarOpen && "w-[236px] max-sm:w-[204px] max-[360px]:w-[188px]",
        )}
        data-open={compactSidebarOpen ? "true" : "false"}
      >
        <div className={cn(
          "px-4 py-4",
          isCompactSidebar && !compactSidebarOpen && "px-2 py-2",
          isCompactSidebar && compactSidebarOpen && "px-4 py-3",
        )}>
          {isCompactSidebar && !compactSidebarOpen ? (
            <button
              type="button"
              onClick={() => setCompactSidebarOpen(true)}
              aria-label="Open settings sidebar"
              className="flex size-10 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]"
            >
              <Icons.SidebarToggle size={16} />
            </button>
          ) : null}

          {!isCompactSidebar && onBack ? (
            <button
              onClick={onBack}
              aria-label="Back"
              className="group mb-3 flex h-7 cursor-pointer items-center gap-2 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icons.Back size={14} className="shrink-0 transition-transform group-hover:-translate-x-0.5" />
              <span className="truncate whitespace-nowrap">Back</span>
            </button>
          ) : null}

          <div className={cn(
            "pl-2 transition-[opacity,height,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] sm:pl-0",
            isCompactSidebar && !compactSidebarOpen && "h-0 w-0 overflow-hidden opacity-0",
            (!isCompactSidebar || compactSidebarOpen) && "h-auto w-auto opacity-100",
          )}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="whitespace-nowrap text-[15px] font-semibold text-foreground">Settings</p>
                <p className="mt-1 whitespace-nowrap text-[12px] text-muted-foreground">Manage OpenClaw</p>
              </div>
              {isCompactSidebar ? (
                <button
                  type="button"
                  onClick={() => setCompactSidebarOpen(false)}
                  aria-label="Close settings sidebar"
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]"
                >
                  <Icons.SidebarToggle size={14} />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <nav className={cn(
          "flex min-h-0 flex-1 flex-col px-3 py-3",
          isCompactSidebar && !compactSidebarOpen && "px-1.5 py-1",
          isCompactSidebar && compactSidebarOpen && "px-3 py-3",
        )}>
          <div className={cn(
            "space-y-5",
            isCompactSidebar && !compactSidebarOpen && "space-y-1.5",
            isCompactSidebar && compactSidebarOpen && "space-y-4",
          )}>
            {SECTION_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1 max-lg:space-y-1.5">
                <p className={cn(
                  "px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 transition-[opacity,height,padding,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isCompactSidebar && !compactSidebarOpen && "h-0 w-0 overflow-hidden p-0 whitespace-nowrap opacity-0",
                  isCompactSidebar && compactSidebarOpen && "h-auto w-auto px-2 pb-1 opacity-100",
                )}>
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <React.Fragment key={item.id}>
                    <SettingsNavButton
                      item={item}
                      isActive={resolvedSection === item.id}
                      onClick={() => handleSidebarClick(item.id)}
                      expanded={!isCompactSidebar || compactSidebarOpen}
                    />
                    {item.id === "config" && isCompactSidebar && !compactSidebarOpen ? (
                      <div className="mx-auto my-1.5 h-px w-7 bg-border/70" />
                    ) : null}
                  </React.Fragment>
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

      {isCompactSidebar && compactSidebarOpen ? (
        <button
          type="button"
          aria-label="Close settings sidebar overlay"
          className="absolute inset-0 z-20 cursor-default bg-transparent"
          onClick={() => setCompactSidebarOpen(false)}
        />
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 scrollbar-hide max-lg:pl-[64px] max-[360px]:pl-16",
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
        !expanded && "h-10 w-full justify-start px-[13px] py-0",
        expanded && "justify-start px-2.5 py-2",
        "outline-none focus-visible:bg-black/[0.055] dark:focus-visible:bg-white/[0.06]",
        isActive
          ? "bg-black/[0.055] text-foreground dark:bg-white/[0.075]"
          : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.045]",
      )}
    >
      <Icon size={16} strokeWidth={isActive ? 2 : 1.5} className="shrink-0" />
      <span className={cn(
        "truncate transition-[opacity,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        !expanded && "w-0 opacity-0",
        expanded && "w-auto opacity-100",
      )}>{item.label}</span>
    </button>
  )
}
