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
  onScrollToMessage: (messageId: string, seq?: number) => void
  onHighlightMessage?: (messageId: string | null) => void
}

/** Use CSS Custom Highlight API to highlight matched text in the DOM */
function highlightTextInElement(messageId: string, query: string) {
  if (!query.trim() || typeof CSS === "undefined" || !("highlights" in CSS)) return
  try {
    const el = document.getElementById(`message-${messageId}`)
    if (!el) return
    const treeWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const ranges: Range[] = []
    const lower = query.toLowerCase()
    while (treeWalker.nextNode()) {
      const node = treeWalker.currentNode
      const text = node.textContent?.toLowerCase() ?? ""
      let startIdx = 0
      while (startIdx < text.length) {
        const idx = text.indexOf(lower, startIdx)
        if (idx < 0) break
        const range = new Range()
        range.setStart(node, idx)
        range.setEnd(node, idx + query.length)
        ranges.push(range)
        startIdx = idx + query.length
      }
    }
    ;(CSS as any).highlights.set("chat-search", new (globalThis as any).Highlight(...ranges))
    // Inject highlight style if not already present
    if (!document.getElementById("chat-search-highlight-style")) {
      const style = document.createElement("style")
      style.id = "chat-search-highlight-style"
      style.textContent = "::highlight(chat-search) { background-color: rgba(250, 204, 21, 0.35); color: #fff; }"
      document.head.appendChild(style)
    }
  } catch {}
}

function clearTextHighlight() {
  try {
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      ;(CSS as any).highlights.delete("chat-search")
    }
  } catch {}
}

export function ChatSearch({ messages, sessionKey, open, onClose, onScrollToMessage, onHighlightMessage }: ChatSearchProps) {
  const [query, setQuery] = useState("")
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestRef = useRef(0)
  const openRef = useRef(open)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      searchRequestRef.current += 1
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setQuery("")
      setMatches([])
      setActiveIndex(0)
      onHighlightMessage?.(null)
      clearTextHighlight()
    }
  }, [open, onHighlightMessage])

  useEffect(() => {
    searchRequestRef.current += 1
    setMatches([])
    setActiveIndex(0)
    onHighlightMessage?.(null)
    clearTextHighlight()
    return () => {
      searchRequestRef.current += 1
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [sessionKey, onHighlightMessage])

  const search = useCallback((q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      searchRequestRef.current += 1
      setMatches([])
      setActiveIndex(0)
      setSearching(false)
      return
    }
    setSearching(true)
    const requestId = ++searchRequestRef.current
    const requestSessionKey = sessionKey
    const requestQuery = q
    const isCurrentSearch = () =>
      openRef.current &&
      searchRequestRef.current === requestId &&
      requestSessionKey === sessionKey &&
      requestQuery === q
    debounceRef.current = setTimeout(async () => {
      try {
        // Search local messages first (instant)
        const lower = requestQuery.toLowerCase()
        const localMatches: SearchMatch[] = []
        for (const msg of messages) {
          if (msg.text?.toLowerCase().includes(lower)) {
            localMatches.push({ messageId: msg.messageId, seq: 0, snippet: "" })
          }
        }
        // Search all messages via middleware (SQLite)
        const result = await middlewareFetch<SearchResult>(
          `/api/chat/search?sessionKey=${encodeURIComponent(requestSessionKey)}&query=${encodeURIComponent(requestQuery)}&limit=50`,
          { timeoutMs: 5000 }
        )
        if (!isCurrentSearch()) return
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
          if (merged.length > 0) {
            onScrollToMessage(merged[0].messageId, merged[0].seq)
            onHighlightMessage?.(merged[0].messageId)
            setTimeout(() => {
              if (isCurrentSearch()) highlightTextInElement(merged[0].messageId, requestQuery)
            }, 600)
          }
        } else {
          setMatches(localMatches)
          setActiveIndex(0)
          if (localMatches.length > 0) {
            onScrollToMessage(localMatches[0].messageId, localMatches[0].seq)
            onHighlightMessage?.(localMatches[0].messageId)
            setTimeout(() => {
              if (isCurrentSearch()) highlightTextInElement(localMatches[0].messageId, requestQuery)
            }, 600)
          }
        }
      } catch {
        if (!isCurrentSearch()) return
        // Fallback to local-only search
        const lower = requestQuery.toLowerCase()
        const found: SearchMatch[] = []
        for (const msg of messages) {
          if (msg.text?.toLowerCase().includes(lower)) {
            found.push({ messageId: msg.messageId, seq: 0, snippet: "" })
          }
        }
        setMatches(found)
        setActiveIndex(0)
        if (found.length > 0) {
          onScrollToMessage(found[0].messageId, found[0].seq)
          onHighlightMessage?.(found[0].messageId)
          setTimeout(() => {
            if (isCurrentSearch()) highlightTextInElement(found[0].messageId, requestQuery)
          }, 600)
        }
      } finally {
        if (isCurrentSearch()) setSearching(false)
      }
    }, 200) // 200ms debounce
  }, [messages, sessionKey, onScrollToMessage, onHighlightMessage])

  const goToMatch = useCallback((direction: "prev" | "next") => {
    if (matches.length === 0) return
    const next = direction === "next"
      ? (activeIndex + 1) % matches.length
      : (activeIndex - 1 + matches.length) % matches.length
    setActiveIndex(next)
    onScrollToMessage(matches[next].messageId, matches[next].seq)
    onHighlightMessage?.(matches[next].messageId)
    setTimeout(() => highlightTextInElement(matches[next].messageId, query), 600)
  }, [matches, activeIndex, onScrollToMessage, onHighlightMessage, query])

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
