import type { CompactionMarker } from "./types"

type TimedMessage = { createdAt?: string }

function messageTimeMs(message: TimedMessage): number {
  if (!message.createdAt) return Number.NaN
  const parsed = Date.parse(message.createdAt)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

export type CompactionPlacement = {
  /** Markers to render immediately BEFORE the message at this index. */
  before: Map<number, CompactionMarker[]>
  /** Markers that belong after the last message (most recent compaction). */
  trailing: CompactionMarker[]
}

/**
 * Interleave compaction markers into a chronologically-ordered message list.
 *
 * A compaction happens between two turns, so a marker is placed just before the
 * first message that is newer than it. Markers newer than every message (or when
 * timestamps are missing) fall into `trailing` and render at the bottom. Markers
 * are assumed already sorted by createdAtMs (the store guarantees this).
 */
export function assignCompactionMarkers(
  messages: TimedMessage[],
  markers: CompactionMarker[],
): CompactionPlacement {
  const before = new Map<number, CompactionMarker[]>()
  const trailing: CompactionMarker[] = []
  if (markers.length === 0) return { before, trailing }

  const times = messages.map(messageTimeMs)

  for (const marker of markers) {
    let placedAt = -1
    for (let i = 0; i < times.length; i += 1) {
      const t = times[i]
      if (!Number.isNaN(t) && t > marker.createdAtMs) {
        placedAt = i
        break
      }
    }
    if (placedAt === -1) {
      trailing.push(marker)
    } else {
      const list = before.get(placedAt)
      if (list) list.push(marker)
      else before.set(placedAt, [marker])
    }
  }

  return { before, trailing }
}
