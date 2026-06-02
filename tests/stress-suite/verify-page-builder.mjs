/**
 * Phase 12 — Verify Page Builder (plain JS)
 */

import fs from "node:fs"
import path from "node:path"

const OUT = path.join(process.cwd(), "test-results", "stress-suite-verify")
fs.mkdirSync(OUT, { recursive: true })

// Inline generator logic
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const TOOL_CATALOG = [
  { name: "exec", input: { command: "echo hello" }, result: "hello\n" },
  { name: "read", input: { path: "README.md" }, result: "# Project\nOpenClaw Desktop\n" },
  { name: "web_fetch", input: { url: "https://example.com", maxChars: 3000 }, result: "<html>Example</html>" },
  { name: "memory_search", input: { query: "stress test" }, result: "memory/2026-06-01.md" },
  { name: "memory_get", input: { path: "memory/2026-06-01.md" }, result: "# Notes\n" },
  { name: "image_generate", input: { prompt: "a cat" }, result: "image.png" },
  { name: "web_search", input: { query: "OpenClaw" }, result: "[{ title: \"OpenClaw\" }]" },
  { name: "sessions_spawn", input: { task: "Audit child", label: "Auditor" }, result: '{"childSessionKey":"agent:main:subagent:child-1"}' },
  { name: "session_status", input: {}, result: '{"model":"gpt-5.5","reasoning":"off"}' },
]

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`

const MARKDOWN_BLOCKS = [
  "# Heading\n\nSome paragraph text here.",
  "```typescript\nconst x = 1;\n```",
  "- Item one\n- Item two\n- Item three",
  "> A blockquote for testing",
  "**Bold** and *italic* text",
]

function generateMessages({ messageCount, toolDensity, toolVariety, toolPattern, includeReasoning, includeContentBlocks, seed }) {
  const rng = seededRandom(seed || 42)
  const tools = TOOL_CATALOG.slice(0, Math.max(1, Math.min(toolVariety || 8, TOOL_CATALOG.length)))
  const messages = []
  let toolCounter = 0
  let runCounter = 0

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? "user" : "assistant"
    const baseText = role === "user"
      ? `User prompt ${i + 1}: ${LOREM.slice(0, 80 + Math.floor(rng() * 120))}`
      : `Assistant response ${i + 1}: ${LOREM} ${MARKDOWN_BLOCKS[i % MARKDOWN_BLOCKS.length]} ${LOREM.slice(0, 200 + Math.floor(rng() * 400))}`

    const msg = {
      messageId: `msg-${i}`,
      role,
      text: baseText,
      createdAt: new Date(Date.now() - (messageCount - i) * 60000).toISOString(),
      openclawSeq: i + 1,
    }

    let shouldInject = false
    if (role === "assistant") {
      if (toolPattern === "sequential") shouldInject = i % Math.floor(1 / (toolDensity || 0.15)) === 3
      else if (toolPattern === "interleaved") shouldInject = rng() < (toolDensity || 0.15)
      else if (toolPattern === "burst") shouldInject = i % 20 < Math.max(2, Math.floor((toolDensity || 0.15) * 10))
      else if (toolPattern === "random") shouldInject = rng() < (toolDensity || 0.15) * 1.5
    }

    if (shouldInject && tools.length > 0) {
      const toolDef = tools[Math.floor(rng() * tools.length)]
      const runId = `run-${runCounter++}`
      const toolCall = {
        id: `tool-${toolCounter++}`,
        tool: toolDef.name,
        status: rng() < 0.9 ? "success" : "error",
        input: toolDef.input,
        resultText: toolDef.result,
        phase: "result",
        runId,
      }

      if (includeContentBlocks) {
        msg.contentBlocks = [
          ...(includeReasoning && rng() < 0.3
            ? [{ type: "thinking", text: `Thinking about ${toolDef.name}...` }]
            : []),
          { type: "toolCall", id: toolCall.id, name: toolDef.name, input: toolDef.input },
        ]
      }

      msg.toolCalls = [toolCall]
      msg.runId = runId
    }

    messages.push(msg)
  }

  return messages
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function renderToolCard(tool) {
  const statusEmoji = tool.status === "success" ? "✅" : tool.status === "error" ? "❌" : "⏳"
  return `<div class="msg-tool" data-tool-id="${tool.id}" data-tool-status="${tool.status}">
  <div class="tool-header">${statusEmoji} ${tool.tool}</div>
  <div class="tool-input">${escapeHtml(JSON.stringify(tool.input))}</div>
  ${tool.resultText ? `<div class="tool-result">${escapeHtml(String(tool.resultText).slice(0, 200))}</div>` : ""}
</div>`
}

function renderContentBlocks(blocks) {
  if (!blocks || blocks.length === 0) return ""
  let html = `<div class="content-blocks">`
  for (const block of blocks) {
    if (block.type === "text") html += `<div class="cb-text">${escapeHtml(block.text)}</div>`
    else if (block.type === "thinking") html += `<div class="cb-thinking">💭 ${escapeHtml(block.text)}</div>`
    else if (block.type === "toolCall") html += `<div class="cb-toolcall">🔧 ${escapeHtml(block.name)}: ${escapeHtml(JSON.stringify(block.input))}</div>`
    else if (block.type === "tool_result") html += `<div class="cb-toolresult">📄 ${escapeHtml(block.content.slice(0, 120))}</div>`
  }
  html += `</div>`
  return html
}

function buildTestPageHtml({ title, messages }) {
  const rows = messages.map((msg) => {
    const isUser = msg.role === "user"
    const isAssistant = msg.role === "assistant"
    const isToolResult = msg.role === "toolResult"
    const cls = isUser ? "msg-user" : isAssistant ? "msg-assistant" : isToolResult ? "msg-toolresult" : "msg-tool"
    const roleLabel = isUser ? "You" : isAssistant ? "Assistant" : "Tool"
    const safeText = escapeHtml(msg.text)
    const attrs = [
      `data-vercel-chat-message-row="true"`,
      `data-ui-id="${msg.messageId}"`,
      `data-message-id="${msg.messageId}"`,
      ...(msg.runId ? [`data-run-id="${msg.runId}"`] : []),
      `data-role="${msg.role}"`,
      ...(msg.openclawSeq !== undefined ? [`data-seq="${msg.openclawSeq}"`] : []),
    ]
    const toolHtml = msg.toolCalls ? msg.toolCalls.map(renderToolCard).join("") : ""
    const blocksHtml = renderContentBlocks(msg.contentBlocks)
    return `<div id="message-${msg.messageId}" class="msg-row ${cls}" ${attrs.join(" ")}>
  <div class="msg-label">${roleLabel}</div>
  <div class="msg-text">${safeText}</div>
  ${blocksHtml}
  ${toolHtml}
</div>`
  }).join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title || "Test")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
  #scroll-container { height: 100vh; overflow-y: auto; overscroll-behavior: contain; }
  .msg-row { max-width: 44rem; margin: 0 auto; padding: 12px 16px; border-bottom: 1px solid; }
  .msg-user { background: #1a1a2e; border-color: #3a3a5e; }
  .msg-assistant { background: #16213e; border-color: #2a4a6e; }
  .msg-label { font-weight: 600; margin-bottom: 4px; }
  .msg-user .msg-label { color: #a0a0ff; }
  .msg-assistant .msg-label { color: #60d060; }
  .msg-text { white-space: pre-wrap; word-break: break-word; }
  .content-blocks { margin-top: 6px; }
  .cb-thinking { color: #888; font-style: italic; font-size: 12px; padding: 4px 0; }
  .cb-toolcall { background: #0a0a1a; border-radius: 4px; padding: 6px; font-size: 12px; color: #aaa; margin-top: 4px; }
  .msg-tool { margin-top: 8px; padding: 8px; background: #0a0a1a; border-radius: 4px; font-size: 12px; color: #888; }
  .tool-header { font-weight: 600; margin-bottom: 4px; }
  .tool-input { font-family: monospace; opacity: 0.7; }
  .tool-result { margin-top: 4px; color: #ccc; }
</style>
</head>
<body>
<main data-audit-real-webui="true">
<div id="scroll-container" data-audit-scroll-container="true">
  <div id="scroll-content">
    ${rows}
  </div>
</div>
</main>
<script>
  window.__STRESS_TEST_DATA = ${JSON.stringify(messages)};
</script>
</body>
</html>`
}

// Run verification
const messages = generateMessages({
  messageCount: 45,
  toolDensity: 0.15,
  toolVariety: 8,
  toolPattern: "interleaved",
  includeReasoning: true,
  includeContentBlocks: true,
  seed: 42,
})

const html = buildTestPageHtml({ title: "stress-verify-45", messages })
const pagePath = path.join(OUT, "verify-page.html")
fs.writeFileSync(pagePath, html)

// Validate HTML structure
const vercelRowMatches = html.match(/data-vercel-chat-message-row="true"/g)
const uiIdMatches = html.match(/data-ui-id=/g)
const messageIdMatches = html.match(/data-message-id=/g)
const runIdMatches = html.match(/data-run-id=/g)
const toolCardMatches = html.match(/class="msg-tool"/g)
const thinkingMatches = html.match(/class="cb-thinking"/g)
const scriptDataMatch = html.match(/window\.__STRESS_TEST_DATA/)

const stats = {
  messageCount: messages.length,
  toolCalls: messages.filter((m) => m.toolCalls?.length).length,
  contentBlocks: messages.filter((m) => m.contentBlocks?.length).length,
  htmlSizeBytes: html.length,
  vercelRowCount: vercelRowMatches ? vercelRowMatches.length : 0,
  uiIdCount: uiIdMatches ? uiIdMatches.length : 0,
  messageIdCount: messageIdMatches ? messageIdMatches.length : 0,
  runIdCount: runIdMatches ? runIdMatches.length : 0,
  toolCardCount: toolCardMatches ? toolCardMatches.length : 0,
  thinkingBlockCount: thinkingMatches ? thinkingMatches.length : 0,
  hasScriptData: !!scriptDataMatch,
  pagePath,
}

fs.writeFileSync(path.join(OUT, "verify-stats.json"), JSON.stringify(stats, null, 2))
console.log("Phase 12 verification complete:")
console.log(JSON.stringify(stats, null, 2))

// Quick assertion-like checks
let issues = []
if (stats.vercelRowCount !== stats.messageCount) issues.push(`Row count mismatch: expected ${stats.messageCount}, got ${stats.vercelRowCount}`)
if (stats.uiIdCount !== stats.messageCount) issues.push(`UI ID count mismatch: expected ${stats.messageCount}, got ${stats.uiIdCount}`)
if (!stats.hasScriptData) issues.push("Missing __STRESS_TEST_DATA script")
if (stats.toolCardCount !== stats.toolCalls) issues.push(`Tool card count mismatch: expected ${stats.toolCalls}, got ${stats.toolCardCount}`)

const verdict = issues.length === 0 ? "PASS" : `FAIL: ${issues.join("; ")}`
console.log("Verdict:", verdict)
process.exit(issues.length > 0 ? 1 : 0)
