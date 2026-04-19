"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { VersionUpdatesTab } from "./tabs/VersionUpdatesTab"
import { CronJobsTab } from "./tabs/CronJobsTab"
import { cn } from "@/lib/utils"

type NotificationSection = "version-updates" | "cron-jobs"

type SidebarItem = {
  id: NotificationSection
  label: string
  icon: React.ElementType
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "cron-jobs", label: "Cron Jobs", icon: Icons.Cron },
  { id: "version-updates", label: "Version Updates", icon: Icons.Notification },
]

type NotificationDashboardProps = {
  onBack?: () => void
  defaultTab?: NotificationSection
}

export function NotificationDashboard({
  onBack,
  defaultTab = "cron-jobs",
}: NotificationDashboardProps) {
  const [activeSection, setActiveSection] =
    React.useState<NotificationSection>(defaultTab)

  return (
    <div className="flex h-full w-full justify-center gap-15 pt-10">
      <nav className="flex w-[180px] shrink-0 flex-col px-3 py-6">
        {onBack && (
          <button
            onClick={onBack}
            className="group mb-4 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icons.Back
              size={14}
              className="transition-transform group-hover:-translate-x-0.5"
            />
            Back
          </button>
        )}

        <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          Notifications
        </p>
        <div className="flex flex-col gap-0.5">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition-colors",
                  isActive
                    ? "bg-foreground/5 text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.5}
                  className="shrink-0"
                />
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="my-2 w-full max-w-xl overflow-y-auto scrollbar-hide md:my-4 lg:my-6">
        {activeSection === "cron-jobs" && <CronJobsTab />}
        {activeSection === "version-updates" && <VersionUpdatesTab />}
      </div>
    </div>
  )
}
