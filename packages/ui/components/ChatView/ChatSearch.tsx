"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { LuSearch, LuChevronUp, LuChevronDown, LuX } from "react-icons/lu"
import { middlewareFetch } from "@/lib/middleware-client"
import type { ChatMessage } from "./types"

type SearchMatch = { messageId: string; seq: number; snippet: string }
type SearchResult = { ok: boolean; results: Array<{ openclawSeq: number; messageId: string | null; role: string | null; snippet: string }> }

interface ChatSearchProps {
  messages: ChatMessage[]
  sessionKey: string
  open: boolean
  onClose: () => void
  onScrollToMessage: (messageId: string) => void
}

export function ChatSearch({ messages, sessionKey, open, onClose, onScrollToMessage }: ChatSearchProps) {
  const [query, setQuery] = useState("")
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery("")
      setMatches([])
      setActiveIndex(0)
    }
  }, [open])

  const search = useCallback((q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setMatches([])
      setActiveIndex(0)
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        // Search local messages first (instant)
        const lower = q.toLowerCase()
        const localMatches: SearchMatch[] = []
        for (const msg of messages) {
          if (msg.text?.toLowerCase().includes(lower)) {
            localMatches.push({ messageId: msg.messageId, seq: 0, snippet: "" })
          }
        }
        // Search all messages via middleware (SQLite)
        const result = await middlewareFetch<SearchResult>(
          `/api/chat/search?sessionKey=${encodeURIComponent(sessionKey)}&query=${encodeURIComponent(q)}&limit=50`,
          { timeoutMs: 5000 }
        )
        if (result.ok && result.results.length > 0) {
          const serverMatches: SearchMatch[] = result.results
            .filter((r) => r.messageId)
            .map((r) => ({ messageId: r.messageId!, seq: r.openclawSeq, snippet: r.snippet }))
          // Merge: server results (complete) take priority, deduped
          const seen = new Set<string>()
          const merged: SearchMatch[] = []
          for (const m of serverMatches) {
            if (!seen.has(m.messageId)) { seen.add(m.messageId); merged.push(m) }
          }
          for (const m of localMatches) {
            if (!seen.has(m.messageId)) { seen.add(m.messageId); merged.push(m) }
          }
          setMatches(merged)
          setActiveIndex(0)
          if (merged.length > 0) onScrollToMessage(merged[0].messageId)
        } else {
          setMatches(localMatches)
          setActiveIndex(0)
          if (localMatches.length > 0) onScrollToMessage(localMatches[0].messageId)
        }
      } catch {
        // Fallback to local-only search
        const lower = q.toLowerCase()
        const found: SearchMatch[] = []
        for (const msg of messages) {
          if (msg.text?.toLowerCase().includes(lower)) {
            found.push({ messageId: msg.messageId, seq: 0, snippet: "" })
          }
        }
        setMatches(found)
        setActiveIndex(0)
        if (found.length > 0) onScrollToMessage(found[0].messageId)
      } finally {
        setSearching(false)
      }
    }, 200) // 200ms debounce
  }, [messages, sessionKey, onScrollToMessage])

  const goToMatch = useCallback((direction: "prev" | "next") => {
    if (matches.length === 0) return
    const next = direction === "next"
      ? (activeIndex + 1) % matches.length
      : (activeIndex - 1 + matches.length) % matches.length
    setActiveIndex(next)
    onScrollToMessage(matches[next].messageId)
  }, [matches, activeIndex, onScrollToMessage])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); e.preventDefault() }
      if (e.key === "Enter" && !e.shiftKey) { goToMatch(e.shiftKey ? "prev" : "next"); e.preventDefault() }
      if (e.key === "Enter" && e.shiftKey) { goToMatch("prev"); e.preventDefault() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose, goToMatch])

  if (!open) return null

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1.5 rounded-lg border border-border/50 bg-card/95 px-3 py-1.5 shadow-lg backdrop-blur-sm">
      <LuSearch size={14} className="shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search messages…"
        className="w-48 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
      />
      {query && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : "0 results"}
        </span>
      )}
      <button
        type="button"
        onClick={() => goToMatch("prev")}
        disabled={matches.length === 0}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <LuChevronUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => goToMatch("next")}
        disabled={matches.length === 0}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
      >
        <LuChevronDown size={14} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <LuX size={14} />
      </button>
    </div>
  )
}
