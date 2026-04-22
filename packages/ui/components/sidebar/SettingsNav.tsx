"use client"

import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"

const iconMap: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  usage: Icons.Automations,
  memory: Icons.Memory,
  user: Icons.UserAccount,
  settings: Icons.Settings,
  grid: Icons.Grid,
  wrench: Icons.Wrench,
  help: Icons.Help,
}

type SettingsItemProps = {
  label: string
  icon: string
  active: boolean
  onClick: () => void
  collapsed: boolean
}

export function SettingsItem({ label, icon, active, onClick, collapsed }: SettingsItemProps) {
  const Icon = iconMap[icon] || Icons.Settings

  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex w-full cursor-pointer items-center rounded-md font-normal transition-colors",
        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1.5 text-left text-[13px]",
        active
          ? "bg-foreground/5 text-foreground shadow-sm backdrop-blur-md"
          : "text-foreground/85 hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon size={16} strokeWidth={active ? 2 : 1.5} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}

type SettingsNavProps = {
  activeTab: string
  onTabChange: (tab: string) => void
  onBackToMain: () => void
  collapsed: boolean
}

export function SettingsNav({ activeTab, onTabChange, onBackToMain, collapsed }: SettingsNavProps) {
  return (
    <div className="flex h-full flex-col gap-1">
      <button
        onClick={onBackToMain}
        title="Back to App"
        className={cn(
          "flex w-full cursor-pointer items-center rounded-md text-left font-medium transition-colors hover:text-foreground",
          collapsed ? "justify-center px-0 py-2" : "gap-1 px-2.5 py-1 text-[12px] text-muted-foreground",
        )}
      >
        <Icons.Back size={16} strokeWidth={1.5} />
        {!collapsed && <span>Back to App</span>}
      </button>

      {!collapsed && <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Personal</div>}
      <SettingsItem label="Usage" icon="usage" active={activeTab === "usage"} onClick={() => onTabChange("usage")} collapsed={collapsed} />
      <SettingsItem label="Memory" icon="memory" active={activeTab === "memory"} onClick={() => onTabChange("memory")} collapsed={collapsed} />

      {!collapsed && <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">System</div>}
      <SettingsItem label="Account" icon="user" active={activeTab === "account"} onClick={() => onTabChange("account")} collapsed={collapsed} />
      <SettingsItem label="Appearance" icon="settings" active={activeTab === "personalization"} onClick={() => onTabChange("personalization")} collapsed={collapsed} />
      <SettingsItem label="Data Control" icon="grid" active={activeTab === "data-control"} onClick={() => onTabChange("data-control")} collapsed={collapsed} />
      <SettingsItem label="Maintenance" icon="wrench" active={activeTab === "maintenance"} onClick={() => onTabChange("maintenance")} collapsed={collapsed} />

      <div className="mt-auto pt-4">
        <SettingsItem label="Help" icon="help" active={activeTab === "help"} onClick={() => onTabChange("help")} collapsed={collapsed} />
      </div>
    </div>
  )
}
