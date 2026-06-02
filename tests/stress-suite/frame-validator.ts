/**
 * Phase 13 — Frame Duplicate & Stale Frame Detection Validator
 *
 * Validates that the instrumentation correctly detects:
 * - Duplicate consecutive frames (identical screenshots)
 * - Tiny frames (<5KB, indicating rendering failure)
 * - Stale frames (scroll position unchanged for >500ms during active scroll)
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

export type FrameValidationConfig = {
  framesDir: string
  duplicateHashThreshold?: number
  tinyFrameSizeThreshold?: number
  staleScrollThresholdMs?: number
}

export type FrameValidationResult = {
  totalFrames: number
  duplicateFrames: number[]
  tinyFrames: Array<{ index: number; size: number }>
  staleFrames: Array<{ index: number; durationMs: number }>
  pass: boolean
  issues: string[]
}

export function validateFrames(config: FrameValidationConfig): FrameValidationResult {
  const {
    framesDir,
    duplicateHashThreshold = 0,
    tinyFrameSizeThreshold = 5000,
    staleScrollThresholdMs = 500,
  } = config

  const issues: string[] = []
  const frameFiles = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith(".png") || f.endsWith(".jpg"))
    .sort()

  const totalFrames = frameFiles.length
  if (totalFrames === 0) {
    issues.push("No frames found in directory")
    return { totalFrames: 0, duplicateFrames: [], tinyFrames: [], staleFrames: [], pass: false, issues }
  }

  // Hash-based duplicate detection
  const hashes: string[] = []
  for (const f of frameFiles) {
    const buf = fs.readFileSync(path.join(framesDir, f))
    hashes.push(crypto.createHash("sha256").update(buf).digest("hex"))
  }

  const duplicateFrames: number[] = []
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] === hashes[i - 1]) {
      duplicateFrames.push(i)
    }
  }

  if (duplicateFrames.length > duplicateHashThreshold) {
    issues.push(`Duplicate frames: ${duplicateFrames.length} (threshold: ${duplicateHashThreshold})`)
  }

  // Tiny frame detection
  const tinyFrames: Array<{ index: number; size: number }> = []
  for (let i = 0; i < frameFiles.length; i++) {
    const s = fs.statSync(path.join(framesDir, frameFiles[i]))
    if (s.size < tinyFrameSizeThreshold) {
      tinyFrames.push({ index: i, size: s.size })
    }
  }

  if (tinyFrames.length > 0) {
    issues.push(`Tiny frames: ${tinyFrames.length} (threshold: ${tinyFrameSizeThreshold} bytes)`)
  }

  // Stale frame detection (requires frame metadata JSON sidecar)
  const staleFrames: Array<{ index: number; durationMs: number }> = []
  const metaPath = path.join(framesDir, "frame-metadata.json")
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Array<{ time: number; scrollTop: number }>
    for (let i = 1; i < meta.length; i++) {
      const deltaMs = meta[i].time - meta[i - 1].time
      const scrollDelta = Math.abs(meta[i].scrollTop - meta[i - 1].scrollTop)
      if (deltaMs > staleScrollThresholdMs && scrollDelta < 2) {
        staleFrames.push({ index: i, durationMs: deltaMs })
      }
    }
  }

  if (staleFrames.length > 0) {
    issues.push(`Stale frames: ${staleFrames.length} (threshold: ${staleScrollThresholdMs}ms)`)
  }

  return {
    totalFrames,
    duplicateFrames,
    tinyFrames,
    staleFrames,
    pass: issues.length === 0,
    issues,
  }
}

/**
 * Batch validator for a suite of frame directories.
 */
export function validateFrameSuite(
  frameDirs: string[],
  config?: Partial<FrameValidationConfig>
): Map<string, FrameValidationResult> {
  const results = new Map<string, FrameValidationResult>()
  for (const dir of frameDirs) {
    results.set(dir, validateFrames({ framesDir: dir, ...config }))
  }
  return results
}
