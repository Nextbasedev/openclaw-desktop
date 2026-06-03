# 0010 — ToolCard + timeline/composer polish

**Branch:** `v5`
**Scope:** `components/chat/ui/rows/ToolCard.tsx`, `rows/AssistantTurn.tsx`,
`rows/ThinkingPlaceholder.tsx`, `ui/Composer.tsx`, `ui/JumpToLatest.tsx`, `ui/Markdown.tsx`,
`ui/CopyButton.tsx` (new). Pure presentational layer.
**Status:** complete — 26/26 tests green, typecheck clean, production build green.
**Depends on:** 0005 (timeline UI), 0009 (scroll anchor).

---

## 1. Summary / why

The user flagged tool-call rendering and general timeline/composer readability as rough.
This is a UI-only pass that implements the Approach A §6.1 (power-dashboard) tool model
properly and tightens the chat surface. No `store/**` or `sync/**` changes.

## 2. What changed

- **`CopyButton.tsx` (new, shared).** Copy-to-clipboard with `stopPropagation` so copying
  inside a clickable card never toggles it; transient "Copied" state; safe no-op when
  clipboard is unavailable (non-secure context).
- **`ToolCard.tsx` (rewrite).**
  - Clean status tokens (`running`=amber, `success`=emerald, `error`=red) applied to the
    **card border + a pill + a status dot** (no more fragile `class.split(" ")[1]`).
  - Pending state pulses the dot and shows an italic "waiting for result…" line.
  - Body = labeled **arguments** + **result** blocks (mono, scroll-capped at ~18rem),
    each with its own copy button; the result block relabels to **error** (red) on
    failure. "view full" sits beside copy and fetches the untruncated result.
  - Header reads "Details/Hide" + chevron; collapsed by default once a result exists.
- **`AssistantTurn.tsx`.** Adds a small "AI" avatar gutter, wraps text at a comfortable
  width, a violet reasoning block with show/hide affordance, and a hover-revealed meta
  row (model · token usage · copy).
- **`ThinkingPlaceholder.tsx`.** Aligned to the same avatar gutter so the streaming
  placeholder lines up with assistant turns.
- **`Composer.tsx`.** Rounded card composer with an auto-growing textarea (max ~13rem), a
  circular send icon, a Stop button while generating, and an "Enter to send" hint.
- **`JumpToLatest.tsx`.** Pill restyle ("Jump to latest"), now anchored above the
  composer (see 0009 ChatViewport restructure) with blur + shadow.
- **`Markdown.tsx`.** The app has **no `@tailwindcss/typography` plugin**, so the prior
  `prose` classes were no-ops — lists rendered as plain lines, code blocks unstyled.
  Replaced `prose` with explicit per-element `components` styling (ul/ol/li discs, inline
  + fenced `code`, tables, links, headings, blockquote) so assistant markdown is actually
  readable without adding a build-config dependency.

## 3. Why these choices

- **Status as border+pill+dot** mirrors the proven power-dashboard transcript and makes a
  card's state readable at a glance even when collapsed.
- **Copy with `stopPropagation`** is the documented §6.1 semantic — copying must never
  toggle the card.
- **Avatar gutter** gives the timeline a clear sender rhythm without heavy bubbles for the
  assistant (user keeps the right-aligned bubble).
- **Presentational only.** Everything reads from existing `ToolRow`/`MessageRow` fields
  (`status`, `argsMeta`, `resultMeta`, `output`, `model`, `usage`), so the tested engine
  is untouched and swappable for AI Elements later.

## 4. Workarounds / gotchas

- Clipboard API is unavailable outside secure contexts; the button degrades to a no-op
  rather than throwing.
- Token-usage parsing tolerates several shapes (`inputTokens`/`input_tokens`/
  `promptTokens`, etc.) since `usage` is `unknown` from the contract.

## 4b. Verified (live DOM, Playwright/Firefox)

Production middleware was wedged during this work (see index note), so the UI was
screenshot-verified against a **local mock** serving contract-accurate bootstrap with
tool calls in every state. Confirmed in real Firefox DOM:
- tool cards render collapsed with correct status color/pill (amber `running`, emerald
  `done`, red `error`); expand shows labeled **ARGUMENTS** + **RESULT/ERROR** blocks with
  COPY and VIEW FULL; the running card shows the pulsing "waiting for result…" line.
- assistant turns show the AI avatar + hover meta (model · tokens · copy); markdown
  bullet lists now show disc markers and fenced code is bordered/monospace.
- composer shows the rounded card, send icon, and Enter-to-send hint.
- Evidence: `webwright-runs/chat-v5-polish/shots/{afterpolish_wait.png,toolcards_expanded.png}`.

## 5. What to test (manual, against live middleware)

1. Open a session **with tool calls** (e.g. one whose bootstrap projects `tools`).
2. Tool cards render collapsed with the right status color/pill; expand → labeled args +
   result; copy buttons work and don't toggle the card; "view full" fetches more.
3. Assistant turns show the AI avatar; hovering reveals model/usage + copy.
4. Composer grows with multi-line input; Enter sends, Shift+Enter newlines; Stop appears
   while generating.

## 6. Follow-ups
- Subagent cards / `SubagentBar` (§6.1) — separate phase.
- Attachment/image/audio inline rendering parity (§6).
- Framer enter/finalize animations + reduced-motion.
