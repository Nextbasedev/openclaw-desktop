"use client"

import * as React from "react"
import { Icons } from "@/components/icons"
import { CronJobsTab } from "./tabs/CronJobsTab"
import { ActivityTab } from "./tabs/ActivityTab"
import { CronJobChat } from "./CronJobChat"
import { cn } from "@/lib/utils"
import type { ActiveChat } from "@/types/chat"

type NotificationSection = "cron-jobs" | "activity"

type SidebarItem = {
  id: NotificationSection
  label: string
  icon: React.ElementType
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "cron-jobs", label: "Cron Jobs", icon: Icons.Cron },
  { id: "activity", label: "Activity", icon: Icons.Automations },
]

type SelectedJob = {
  jobId: string
  name: string
  session: string
  schedule: string
}

type NotificationDashboardProps = {
  onBack?: () => void
  defaultTab?: NotificationSection
  onNavigateToChat?: (chat: ActiveChat) => void
}

export function NotificationDashboard({
  onBack,
  defaultTab = "cron-jobs",
  onNavigateToChat,
}: NotificationDashboardProps) {
  const [activeSection, setActiveSection] =
    React.useState<NotificationSection>(defaultTab)
  const [selectedJob, setSelectedJob] =
    React.useState<SelectedJob | null>(null)

  const handleSectionChange = (id: NotificationSection) => {
    setActiveSection(id)
    setSelectedJob(null)
  }

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
                onClick={() => handleSectionChange(item.id)}
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
        {selectedJob ? (
          <CronJobChat
            sessionKey={selectedJob.session}
            jobName={selectedJob.name}
            schedule={selectedJob.schedule}
            onBack={() => setSelectedJob(null)}
          />
        ) : (
          <>
            {activeSection === "cron-jobs" && (
              <CronJobsTab
                onNavigateToChat={onNavigateToChat}
                onSelectJob={setSelectedJob}
              />
            )}
            {activeSection === "activity" && <ActivityTab />}
          </>
        )}
      </div>
    </div>
  )
}
