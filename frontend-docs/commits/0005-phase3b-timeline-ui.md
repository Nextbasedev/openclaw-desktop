# 0005 — Phase 3b: Timeline UI (virtualized history + live tail + composer)

**Branch:** `v5`
**Scope:** `packages/ui/components/chat/ui/**`, `runtime/useStickToBottom.ts`,
`components/chat/index.ts`, `app/chat-v5/page.tsx`; dep `@tanstack/react-virtual`.
**Status:** complete — 26/26 tests pass, UI typecheck clean, **production build green**
(`/chat-v5` prerendered).
**Depends on:** 0004 (store runtime bridge)

---

## 1. Summary

The first **visible** phase: the actual chat screen rendering from `useChatSession()`.
Virtualized finalized history + a non-virtualized live tail (so streaming never
re-measures history), tool/reasoning cards (power-dashboard interaction model),
stick-to-bottom scrolling, older-message infinite scroll, and a composer. Mounted on a
gated dev route `/chat-v5` so it can be previewed without touching `AppPage`.

## 2. What was added

- `ui/ChatScreen.tsx` — `ChatSyncProvider` + `ChatViewport`.
- `ui/ChatViewport.tsx` — ONE stable scroll container holding the older sentinel,
  `VirtualHistory`, `LiveTail`, `JumpToLatest`, and the `Composer`. Resolves a row's
  tools from `session.tools`.
- `ui/VirtualHistory.tsx` — `@tanstack/react-virtual` over `history` rows; dynamic
  measurement, `scrollMargin` for the sentinel above, stable `getItemKey` = row key.
- `ui/LiveTail.tsx` — non-virtualized active/unfinalized rows + `ThinkingPlaceholder`.
  The only subtree that re-renders on deltas.
- `ui/rows/Row.tsx` — dispatch (memoized) → `UserRow` / `AssistantTurn`.
- `ui/rows/UserRow.tsx` — right-aligned bubble (optimistic = dimmed).
- `ui/rows/AssistantTurn.tsx` — collapsible Reasoning + `ToolCard[]` + `Markdown` + meta.
- `ui/rows/ToolCard.tsx` — collapsible card (power-dashboard model): name + status pill,
  args + result/pending, "view full" → `toolResult()`.
- `ui/rows/ThinkingPlaceholder.tsx`, `ui/JumpToLatest.tsx`, `ui/LoadOlderSentinel.tsx`,
  `ui/Markdown.tsx`, `ui/Composer.tsx`.
- `runtime/useStickToBottom.ts` — `isAtBottom` intent + `ResizeObserver` follow.
- `components/chat/index.ts` — public exports.
- `app/chat-v5/page.tsx` — gated preview route (`NEXT_PUBLIC_CHAT_V5=1`,
  `?session=<key>`).
- `useChatSession` now also exposes `tools` + `toolResult`.

## 3. Why these choices

- **Virtual history + non-virtual live tail.** The active turn renders outside the
  virtualizer, so streaming deltas never invalidate virtualizer measurements — kills
  the v4 re-render storm at the structural level. On `run.done` the row flips
  `finalized` (Phase 1) and migrates into the virtualized list.
- **Memoized rows keyed by stable identity.** `Row`/`UserRow`/`AssistantTurn`/`ToolCard`
  are `memo`'d; history rows don't re-render while the live tail streams.
- **Single scroll viewport**, never remounted; `useStickToBottom` follows growth only
  when pinned, shows `JumpToLatest` otherwise.
- **Power-dashboard tool UX** (doc 0002 / plan §6.1) implemented in `ToolCard`.

## 4. Workarounds / gotchas

- **AI Elements deferred (tradeoff).** The plan called for vendoring AI Elements via the
  shadcn registry. That needs a network/CLI step I can't verify in this run, and risks a
  red build. Instead I built small self-contained components on the **existing** stack
  (`react-markdown` + remark-gfm/breaks, Tailwind shadcn tokens, `cn`). They're
  presentational and swappable — AI Elements can replace `Markdown`/`ToolCard`/etc.
  later without touching the store/runtime. Not a hack; a deliberate dependency-risk
  call. Documented so it's visible.
- **react-virtual inside a larger scroll area.** Mixing a virtualized list with the
  live tail in one scroll container requires `scrollMargin = list.offsetTop` and
  `transform: translateY(start - scrollMargin)`. Standard pattern, but easy to get
  subtly wrong → noted for 3c tuning (scroll anchoring on older-load).
- **No jsdom** → components verified by `typecheck` + the **production build** (the route
  imports the module, so the build actually compiles/prerenders it). Behavioural logic
  remains covered by the headless store/sync tests.

## 5. What improved

- A real, buildable chat surface driven entirely by the tested engine.
- Streaming isolation and stable keys carried from the store into the DOM.
- Previewable in isolation (`/chat-v5`) with zero risk to the existing app shell.

## 6. What to test

Automated (this commit):
- `pnpm --filter ui vitest run components/chat` → 26 green (engine unchanged).
- `pnpm --filter ui typecheck` → clean.
- `NEXT_PUBLIC_CHAT_V5=1 pnpm --filter ui build` → **green**; `/chat-v5` prerendered.

Manual (next, against a running middleware):
1. Open `/chat-v5?session=<key>`; history loads from bootstrap.
2. Send a message → user bubble appears immediately, no blink on confirm.
3. Assistant streams into one bubble; tool cards appear/collapse; "Thinking…" only
   before text.
4. Run finishes → bubble finalizes, migrates into history; no flash.
5. Scroll up → `JumpToLatest` appears, autoscroll stops; scroll to bottom re-pins.
6. Scroll to top with more history → older messages load (verify no viewport jump —
   scroll anchoring is the known 3c follow-up).

## 7. Follow-ups
- 3c: scroll-anchor preservation on older-load (compensate scrollTop by inserted
  height); Framer enter/finalize animations; reduced-motion.
- Phase 4+: tool approvals, subagent bar, composer parity (attachments/voice/actions).
- Cutover: wire into `AppPage` behind the flag; remove `@assistant-ui/*` when replaced.
