import { describe, expect, test } from "vitest"
import { assignCompactionMarkers } from "./compactionPlacement"
import type { CompactionMarker } from "./types"

function marker(id: string, createdAtMs: number, runId?: string): CompactionMarker {
  return { id, createdAtMs, summary: `summary ${id}`, runId: runId ?? null }
}

const msg = (iso: string) => ({ createdAt: iso })

describe("assignCompactionMarkers", () => {
  test("no markers -> empty placement", () => {
    const { before, trailing } = assignCompactionMarkers([msg("2026-07-02T00:00:00Z")], [])
    expect(before.size).toBe(0)
    expect(trailing).toEqual([])
  })

  test("places a marker before the first message newer than it", () => {
    const messages = [
      msg("2026-07-02T00:00:00Z"), // 0
      msg("2026-07-02T02:00:00Z"), // 1
      msg("2026-07-02T04:00:00Z"), // 2
    ]
    const m = marker("m1", Date.parse("2026-07-02T01:00:00Z"))
    const { before, trailing } = assignCompactionMarkers(messages, [m])
    expect(trailing).toEqual([])
    expect(before.get(1)).toEqual([m])
  })

  test("markers newer than every message go to trailing", () => {
    const messages = [msg("2026-07-02T00:00:00Z")]
    const m = marker("late", Date.parse("2026-07-02T09:00:00Z"))
    const { before, trailing } = assignCompactionMarkers(messages, [m])
    expect(before.size).toBe(0)
    expect(trailing).toEqual([m])
  })

  test("multiple markers keyed to the same boundary index", () => {
    const messages = [msg("2026-07-02T00:00:00Z"), msg("2026-07-02T05:00:00Z")]
    const a = marker("a", Date.parse("2026-07-02T01:00:00Z"))
    const b = marker("b", Date.parse("2026-07-02T02:00:00Z"))
    const { before } = assignCompactionMarkers(messages, [a, b])
    expect(before.get(1)).toEqual([a, b])
  })

  test("empty message list -> all markers trailing", () => {
    const a = marker("a", 100)
    const { before, trailing } = assignCompactionMarkers([], [a])
    expect(before.size).toBe(0)
    expect(trailing).toEqual([a])
  })

  test("messages with unparseable timestamps are skipped as boundaries", () => {
    const messages = [{ createdAt: undefined }, msg("2026-07-02T03:00:00Z")]
    const m = marker("m", Date.parse("2026-07-02T01:00:00Z"))
    const { before, trailing } = assignCompactionMarkers(messages, [m])
    expect(trailing).toEqual([])
    expect(before.get(1)).toEqual([m])
  })
})
