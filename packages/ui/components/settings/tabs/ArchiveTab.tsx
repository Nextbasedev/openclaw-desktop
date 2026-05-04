"use client"

import { useState, useEffect, useCallback } from "react"
import { LuArchive, LuRotateCcw } from "react-icons/lu"
import {
  fetchProjects,
  archiveProject,
  type Project,
} from "@/lib/api/projects"
import { fetchTopics, archiveTopic, type Topic } from "@/lib/api/topics"
import { archiveChat, fetchChats } from "@/lib/api/chats"
import type { Chat } from "@/types/chat"
import { emit, on } from "@/lib/events"

type ArchivedTopic = Topic & { projectName: string }

export function ArchiveTab() {
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([])
  const [archivedTopics, setArchivedTopics] = useState<ArchivedTopic[]>([])
  const [archivedChats, setArchivedChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { projects } = await fetchProjects()
      const { chats } = await fetchChats(true)
      const archivedChatItems = chats.filter((chat) => chat.archived)
      archivedChatItems.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      setArchivedChats(archivedChatItems)

      const archived = projects.filter((p) => p.archived)
      archived.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      setArchivedProjects(archived)

      const topicResults = await Promise.allSettled(
        projects.map(async (project) => {
          const { topics } = await fetchTopics(project.id)
          return topics
            .filter((topic) => topic.archived)
            .map((topic) => ({ ...topic, projectName: project.name }))
        }),
      )
      const allTopics = topicResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      )
      allTopics.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      setArchivedTopics(allTopics)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load archive")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => on("archive:changed", load), [load])

  function notifyArchiveRestored() {
    window.dispatchEvent(new CustomEvent("archive-restored"))
    emit("archive:changed")
    emit("sidebar:refresh")
  }

  async function handleRestoreProject(projectId: string) {
    try {
      await archiveProject(projectId, false)
      setArchivedProjects((prev) =>
        prev.filter((item) => item.id !== projectId),
      )
      notifyArchiveRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore project")
    }
  }

  async function handleRestoreTopic(topicId: string) {
    try {
      await archiveTopic(topicId, false)
      setArchivedTopics((prev) =>
        prev.filter((item) => item.id !== topicId),
      )
      notifyArchiveRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore topic")
    }
  }

  async function handleRestoreChat(chatId: string) {
    try {
      await archiveChat(chatId, false)
      setArchivedChats((prev) =>
        prev.filter((item) => item.id !== chatId),
      )
      notifyArchiveRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore chat")
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const isEmpty =
    archivedProjects.length === 0 &&
    archivedTopics.length === 0 &&
    archivedChats.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Archive</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived chats, projects, and topics. Restore anytime.
        </p>
      </div>

      {loading && (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-xl border border-border/50 bg-card"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && isEmpty && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-8 text-center">
          <LuArchive
            size={20}
            className="mx-auto mb-2 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No archived items yet.
          </p>
        </div>
      )}

      {!loading && !error && archivedChats.length > 0 && (
        <div>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Chats
          </p>
          <div className="overflow-hidden rounded-md border border-border/50 bg-card">
            {archivedChats.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/10 ${idx > 0 ? "border-t border-border/20" : ""}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                  <LuArchive size={14} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(item.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestoreChat(item.id)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <LuRotateCcw size={13} />
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && archivedProjects.length > 0 && (
        <div>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Projects
          </p>
          <div className="overflow-hidden rounded-md border border-border/50 bg-card">
            {archivedProjects.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/10 ${idx > 0 ? "border-t border-border/20" : ""}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                  <LuArchive size={14} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(item.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestoreProject(item.id)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <LuRotateCcw size={13} />
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && archivedTopics.length > 0 && (
        <div>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Topics
          </p>
          <div className="overflow-hidden rounded-md border border-border/50 bg-card">
            {archivedTopics.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/10 ${idx > 0 ? "border-t border-border/20" : ""}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                  <LuArchive size={14} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {item.projectName} &middot; {formatDate(item.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestoreTopic(item.id)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <LuRotateCcw size={13} />
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
