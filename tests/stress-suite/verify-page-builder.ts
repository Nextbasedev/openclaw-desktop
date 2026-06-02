/**
 * Phase 12 — Verify Synthetic HTML Page Builder Output
 */

import { generateSyntheticMessages } from "./generators.ts"
import { buildTestPageHtml } from "./page-builder.ts"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const OUT = join(process.cwd(), "test-results", "stress-suite-verify")
mkdirSync(OUT, { recursive: true })

const messages = generateSyntheticMessages({
  messageCount: 45,
  toolDensity: 0.15,
  toolVariety: 8,
  toolPattern: "interleaved",
  includeReasoning: true,
  includeContentBlocks: true,
  seed: 42,
})

const html = buildTestPageHtml({
  title: "stress-verify-45",
  messages,
})

const pagePath = join(OUT, "verify-page.html")
writeFileSync(pagePath, html)

const stats = {
  messageCount: messages.length,
  toolCalls: messages.filter((m) => m.toolCalls?.length).length,
  contentBlocks: messages.filter((m) => m.contentBlocks?.length).length,
  userMessages: messages.filter((m) => m.role === "user").length,
  assistantMessages: messages.filter((m) => m.role === "assistant").length,
  htmlSizeBytes: html.length,
  pagePath,
}

writeFileSync(join(OUT, "verify-stats.json"), JSON.stringify(stats, null, 2))
console.log("Verification complete:")
console.log(JSON.stringify(stats, null, 2))
