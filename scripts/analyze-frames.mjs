import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const FRAMES_DIR = process.argv[2] || "/root/.openclaw/workspace/openclaw-desktop/test-results/long-chat-audit/frames-all"
const OUTPUT = join(FRAMES_DIR, "..", "frame-analysis.json")

const files = readdirSync(FRAMES_DIR)
  .filter((f) => f.endsWith(".jpg"))
  .sort()

console.log(`Analyzing ${files.length} frames...`)

const results = []

let prevBuffer = null
let prevFile = null

for (const file of files) {
  const path = join(FRAMES_DIR, file)
  const buffer = readFileSync(path)
  const size = buffer.length

  // A blank frame would be very small (mostly black)
  const isBlank = size < 5000

  // Check for exact duplicates (same buffer)
  let isDuplicate = false
  let duplicateOf = undefined
  if (prevBuffer && buffer.equals(prevBuffer)) {
    isDuplicate = true
    duplicateOf = prevFile || undefined
  }

  results.push({ frame: file, size, isBlank, isDuplicate, duplicateOf })

  prevBuffer = buffer
  prevFile = file
}

const blankFrames = results.filter((r) => r.isBlank)
const duplicateFrames = results.filter((r) => r.isDuplicate)

const analysis = {
  totalFrames: files.length,
  blankFrames: {
    count: blankFrames.length,
    frames: blankFrames.map((r) => r.frame),
  },
  duplicateFrames: {
    count: duplicateFrames.length,
    frames: duplicateFrames.map((r) => ({ frame: r.frame, duplicateOf: r.duplicateOf })),
  },
  verdict: blankFrames.length === 0 && duplicateFrames.length === 0 ? "PASS" : "ISSUE_FOUND",
  summary: {
    allFramesPresent: files.length > 100,
    noBlankFrames: blankFrames.length === 0,
    noDuplicateFrames: duplicateFrames.length === 0,
  },
}

writeFileSync(OUTPUT, JSON.stringify(analysis, null, 2))
console.log(`Analysis saved to ${OUTPUT}`)
console.log(`Total frames: ${analysis.totalFrames}`)
console.log(`Blank frames: ${analysis.blankFrames.count}`)
console.log(`Duplicate frames: ${analysis.duplicateFrames.count}`)
console.log(`Verdict: ${analysis.verdict}`)
