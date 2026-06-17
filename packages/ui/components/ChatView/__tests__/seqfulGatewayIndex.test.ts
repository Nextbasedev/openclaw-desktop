/**
 * BUG-4 regression test (docs/audit/frontend-window-audit-2026-06-17.md).
 *
 * `applyToolPatch` synthesizes a `live:${runId}:tools` row with
 * `gatewayIndex = undefined` when the parent user message has been evicted.
 * The ChatView live-append handler previously took
 * `messages[messages.length - 1].gatewayIndex` and, finding undefined, wrote
 * `appendedNewestSeq = null`. `applyLiveAppend` then fell back to
 * `prevState.newestLoadedSeq` \u2014 effectively freezing the cursor and causing
 * subsequent `fetchNewerPage` calls to re-request rows we already streamed.
 *
 * `lastSeqfulGatewayIndex` / `firstSeqfulGatewayIndex` walk through the array
 * skipping seqless rows so a synthetic row at the boundary does not poison
 * the derived window cursors.
 */

import { describe, expect, test } from "vitest"
import { firstSeqfulGatewayIndex, lastSeqfulGatewayIndex } from "../messageWindow"

type Row = { gatewayIndex?: number | null | undefined }

describe("lastSeqfulGatewayIndex (BUG-4)", () => {
  test("returns gatewayIndex of the last row when present", () => {
    const rows: Row[] = [{ gatewayIndex: 10 }, { gatewayIndex: 20 }]
    expect(lastSeqfulGatewayIndex(rows)).toBe(20)
  })

  test("skips trailing row with undefined gatewayIndex (synthesized tool row)", () => {
    // BUG-4 scenario: applyToolPatch appended a live:${runId}:tools row with
    // gatewayIndex=undefined; previous code returned null which froze
    // windowState.newestLoadedSeq.
    const rows: Row[] = [
      { gatewayIndex: 100 },
      { gatewayIndex: undefined },
    ]
    expect(lastSeqfulGatewayIndex(rows)).toBe(100)
  })

  test("skips multiple seqless trailing rows", () => {
    const rows: Row[] = [
      { gatewayIndex: 50 },
      { gatewayIndex: undefined },
      { gatewayIndex: undefined },
      { gatewayIndex: null },
    ]
    expect(lastSeqfulGatewayIndex(rows)).toBe(50)
  })

  test("returns null when no row carries a seq", () => {
    const rows: Row[] = [{ gatewayIndex: undefined }, { gatewayIndex: null }]
    expect(lastSeqfulGatewayIndex(rows)).toBeNull()
  })

  test("returns null for empty array", () => {
    expect(lastSeqfulGatewayIndex([])).toBeNull()
  })

  test("rejects NaN gatewayIndex (treated as no seq)", () => {
    const rows: Row[] = [{ gatewayIndex: 10 }, { gatewayIndex: NaN }]
    expect(lastSeqfulGatewayIndex(rows)).toBe(10)
  })
})

describe("firstSeqfulGatewayIndex (BUG-4 mirror, head end)", () => {
  test("returns gatewayIndex of the first row when present", () => {
    const rows: Row[] = [{ gatewayIndex: 10 }, { gatewayIndex: 20 }]
    expect(firstSeqfulGatewayIndex(rows)).toBe(10)
  })

  test("skips leading seqless rows", () => {
    const rows: Row[] = [
      { gatewayIndex: undefined },
      { gatewayIndex: 50 },
      { gatewayIndex: 60 },
    ]
    expect(firstSeqfulGatewayIndex(rows)).toBe(50)
  })

  test("returns null when no row carries a seq", () => {
    const rows: Row[] = [{ gatewayIndex: undefined }, { gatewayIndex: null }]
    expect(firstSeqfulGatewayIndex(rows)).toBeNull()
  })

  test("returns null for empty array", () => {
    expect(firstSeqfulGatewayIndex([])).toBeNull()
  })
})
