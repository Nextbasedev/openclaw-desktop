// Remembers which tool cards have already played their entrance animation in
// this tab. Streaming tool results arrive in bursts and the assistant message
// row can remount (e.g. a live row swapping to its sequenced id), which would
// otherwise replay every card's fade/slide again — the "animates many times"
// flicker. Once a card's entrance completes we snap it to its resting state on
// every later render. Bounded so it can't grow without limit.

const MAX_TRACKED = 512
const seenToolEntranceIds = new Set<string>()

export function toolEntranceKey(sessionKey: string | undefined, callId: string): string {
  return `${sessionKey ?? ""}:${callId}`
}

// True the first time we see a given tool id; false once its entrance has been
// marked complete, so bursts and remounts never re-trigger the animation.
export function shouldPlayToolEntrance(key: string): boolean {
  return !seenToolEntranceIds.has(key)
}

export function markToolEntranceSeen(key: string): void {
  if (seenToolEntranceIds.has(key)) return
  if (seenToolEntranceIds.size >= MAX_TRACKED) {
    const oldest = seenToolEntranceIds.values().next().value
    if (oldest !== undefined) seenToolEntranceIds.delete(oldest)
  }
  seenToolEntranceIds.add(key)
}

// Test-only: clear the module-level memory between cases.
export function __resetToolEntranceMemoryForTests(): void {
  seenToolEntranceIds.clear()
}
