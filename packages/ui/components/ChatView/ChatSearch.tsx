"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { LuSearch, LuChevronUp, LuChevronDown, LuX } from "react-icons/lu"
import type { ChatMessage } from "./types"

interface ChatSearchProps {
  messages: ChatMessage[]
  open: boolean
  onClose: () => void
  onScrollToMessage: (messageId: string) => void
}

export function ChatSearch({ messages, open, onClose, onScrollToMessage }: ChatSearchProps) {
  const [query, setQuery] = useState("")
  const [matches, setMatches] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (!q.trim()) {
      setMatches([])
      setActiveIndex(0)
      return
    }
    const lower = q.toLowerCase()
    const found: string[] = []
    for (const msg of messages) {
      if (msg.text?.toLowerCase().includes(lower)) {
        found.push(msg.messageId)
      }
    }
    setMatches(found)
    setActiveIndex(0)
    if (found.length > 0) onScrollToMessage(found[0])
  }, [messages, onScrollToMessage])

  const goToMatch = useCallback((direction: "prev" | "next") => {
    if (matches.length === 0) return
    const next = direction === "next"
      ? (activeIndex + 1) % matches.length
      : (activeIndex - 1 + matches.length) % matches.length
    setActiveIndex(next)
    onScrollToMessage(matches[next])
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
