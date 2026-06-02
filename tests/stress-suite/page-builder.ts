/**
 * Phase 5 — Synthetic HTML Test Page Generator for Stress Suite
 *
 * Builds standalone HTML pages that render synthetic chat timelines
 * with the same data attributes the real OpenClawVercelChat uses,
 * enabling the stress suite to run against pure HTML without a dev server.
 */

import type { SyntheticMessage, SyntheticToolCall } from "./generators"

export type TestPageConfig = {
  title?: string
  messages: SyntheticMessage[]
  dataAuditRealWebui?: boolean
  includeScrollContainerAttr?: boolean
  includeVercelRowAttr?: boolean
  includeUiIdAttr?: boolean
  includeMessageIdAttr?: boolean
  includeThinkingIndicator?: boolean
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function renderToolCard(tool: SyntheticToolCall): string {
  const statusEmoji = tool.status === "success" ? "✅" : tool.status === "error" ? "❌" : "⏳"
  return `<div class="msg-tool" data-tool-id="${tool.id}" data-tool-status="${tool.status}">
  <div class="tool-header">${statusEmoji} ${tool.tool}</div>
  <div class="tool-input">${escapeHtml(JSON.stringify(tool.input))}</div>
  ${tool.resultText ? `<div class="tool-result">${escapeHtml(String(tool.resultText).slice(0, 200))}</div>` : ""}
</div>`
}

function renderContentBlocks(
  blocks: SyntheticMessage["contentBlocks"]
): string {
  if (!blocks || blocks.length === 0) return ""
  let html = `<div class="content-blocks">`
  for (const block of blocks) {
    if (block.type === "text") {
      html += `<div class="cb-text">${escapeHtml(block.text)}</div>`
    } else if (block.type === "thinking") {
      html += `<div class="cb-thinking">💭 ${escapeHtml(block.text)}</div>`
    } else if (block.type === "toolCall") {
      html += `<div class="cb-toolcall">🔧 ${escapeHtml(block.name)}: ${escapeHtml(JSON.stringify(block.input))}</div>`
    } else if (block.type === "tool_result") {
      html += `<div class="cb-toolresult">📄 ${escapeHtml(block.content.slice(0, 120))}</div>`
    }
  }
  html += `</div>`
  return html
}

export function buildTestPageHtml(config: TestPageConfig): string {
  const {
    title = "Stress Test Page",
    messages,
    dataAuditRealWebui = true,
    includeScrollContainerAttr = true,
    includeVercelRowAttr = true,
    includeUiIdAttr = true,
    includeMessageIdAttr = true,
    includeThinkingIndicator = false,
  } = config

  const rows = messages.map((msg, i) => {
    const isUser = msg.role === "user"
    const isAssistant = msg.role === "assistant"
    const isToolResult = msg.role === "toolResult"
    const cls = isUser ? "msg-user" : isAssistant ? "msg-assistant" : isToolResult ? "msg-toolresult" : "msg-tool"
    const roleLabel = isUser ? "You" : isAssistant ? "Assistant" : "Tool"
    const safeText = escapeHtml(msg.text)

    const attrs: string[] = []
    if (includeVercelRowAttr) attrs.push(`data-vercel-chat-message-row="true"`)
    if (includeUiIdAttr && msg.messageId) attrs.push(`data-ui-id="${msg.messageId}"`)
    if (includeMessageIdAttr && msg.messageId) attrs.push(`data-message-id="${msg.messageId}"`)
    if (msg.runId) attrs.push(`data-run-id="${msg.runId}"`)
    if (msg.role) attrs.push(`data-role="${msg.role}"`)
    if (msg.openclawSeq !== undefined) attrs.push(`data-seq="${msg.openclawSeq}"`)

    const toolHtml = msg.toolCalls ? msg.toolCalls.map(renderToolCard).join("") : ""
    const blocksHtml = renderContentBlocks(msg.contentBlocks)

    return `<div id="message-${msg.messageId}" class="msg-row ${cls}" ${attrs.join(" ")}>
  <div class="msg-label">${roleLabel}</div>
  <div class="msg-text">${safeText}</div>
  ${blocksHtml}
  ${toolHtml}
</div>`
  }).join("\n")

  const thinkingHtml = includeThinkingIndicator
    ? `<div class="msg-row msg-assistant" data-vercel-chat-message-row="true" data-role="assistant" data-thinking="true">
  <div class="msg-label">Assistant</div>
  <div class="msg-text">Thinking…</div>
</div>`
    : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
  #scroll-container { height: 100vh; overflow-y: auto; overscroll-behavior: contain; }
  .msg-row { max-width: 44rem; margin: 0 auto; padding: 12px 16px; border-bottom: 1px solid; }
  .msg-user { background: #1a1a2e; border-color: #3a3a5e; }
  .msg-assistant { background: #16213e; border-color: #2a4a6e; }
  .msg-toolresult { background: #1e1e2e; border-color: #4a4a6e; }
  .msg-tool { background: #2e1a1a; border-color: #6e3a3a; }
  .msg-label { font-weight: 600; margin-bottom: 4px; }
  .msg-user .msg-label { color: #a0a0ff; }
  .msg-assistant .msg-label { color: #60d060; }
  .msg-text { white-space: pre-wrap; word-break: break-word; }
  .content-blocks { margin-top: 6px; }
  .cb-thinking { color: #888; font-style: italic; font-size: 12px; padding: 4px 0; }
  .cb-toolcall { background: #0a0a1a; border-radius: 4px; padding: 6px; font-size: 12px; color: #aaa; margin-top: 4px; }
  .cb-toolresult { background: #0a1a0a; border-radius: 4px; padding: 6px; font-size: 12px; color: #8f8; margin-top: 4px; }
  .msg-tool { margin-top: 8px; padding: 8px; background: #0a0a1a; border-radius: 4px; font-size: 12px; color: #888; }
  .tool-header { font-weight: 600; margin-bottom: 4px; }
  .tool-input { font-family: monospace; opacity: 0.7; }
  .tool-result { margin-top: 4px; color: #ccc; }
</style>
</head>
<body>
<main ${dataAuditRealWebui ? 'data-audit-real-webui="true"' : ""}>
<div id="scroll-container" ${includeScrollContainerAttr ? 'data-audit-scroll-container="true"' : ""}>
  <div id="scroll-content">
    ${rows}
    ${thinkingHtml}
  </div>
</div>
</main>
<script>
  window.__STRESS_TEST_DATA = ${JSON.stringify(messages)};
</script>
</body>
</html>`
}
