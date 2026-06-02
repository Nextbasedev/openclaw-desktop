/**
 * Phase 2 — Core Parameterized Message + Tool Call Generator
 *
 * Generates synthetic chat timelines with configurable:
 * - messageCount (N)
 * - toolDensity (tools per N messages)
 * - toolVariety (M distinct tool types)
 * - pattern (sequential, interleaved, burst)
 */

export type ToolPattern = "sequential" | "interleaved" | "burst" | "random"

export type SyntheticToolCall = {
  id: string
  tool: string
  status: "success" | "running" | "error"
  input: Record<string, unknown>
  resultText?: string
  phase?: "start" | "calling" | "result" | "error" | "update"
  runId?: string
}

export type SyntheticMessage = {
  messageId: string
  role: "user" | "assistant" | "tool" | "toolResult"
  text: string
  createdAt: string
  openclawSeq?: number
  runId?: string
  toolCalls?: SyntheticToolCall[]
  contentBlocks?: Array<
    | { type: "text"; text: string }
    | { type: "toolCall"; id: string; name: string; input: Record<string, unknown> }
    | { type: "thinking"; text: string }
    | { type: "tool_result"; tool_use_id: string; content: string }
  >
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
  { name: "edit", input: { path: "src/index.ts", oldText: "foo", newText: "bar" }, result: "ok" },
  { name: "write", input: { path: "/tmp/test.txt", content: "hello" }, result: "ok" },
  { name: "code_checker", input: { path: "src/index.ts" }, result: "[]" },
  { name: "video_generate", input: { prompt: "a rocket" }, result: "video.mp4" },
  { name: "image", input: { image: "https://example.com/img.png", prompt: "describe" }, result: "A scenic photo." },
  { name: "process", input: { action: "list" }, result: "[]" },
]

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`

const MARKDOWN_BLOCKS = [
  "# Heading\n\nSome paragraph text here.",
  "```typescript\nconst x = 1;\n```",
  "- Item one\n- Item two\n- Item three",
  "> A blockquote for testing",
  "**Bold** and *italic* text",
  "| A | B |\n|---|---|\n| 1 | 2 |",
  "1. First\n2. Second\n3. Third",
  "```python\ndef hello():\n    return 'world'\n```",
]

export type GeneratorOptions = {
  messageCount: number
  toolDensity?: number // average tools per message (0-1, default 0.15)
  toolVariety?: number // how many distinct tools from catalog (1-15, default 8)
  toolPattern?: ToolPattern
  includeReasoning?: boolean
  includeContentBlocks?: boolean
  includeOptimisticUser?: boolean
  seed?: number
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function generateSyntheticMessages(options: GeneratorOptions): SyntheticMessage[] {
  const {
    messageCount,
    toolDensity = 0.15,
    toolVariety = 8,
    toolPattern = "interleaved",
    includeReasoning = true,
    includeContentBlocks = true,
    includeOptimisticUser = false,
    seed = 42,
  } = options

  const rng = seededRandom(seed)
  const tools = TOOL_CATALOG.slice(0, Math.max(1, Math.min(toolVariety, TOOL_CATALOG.length)))
  const messages: SyntheticMessage[] = []

  let nextSeq = 1
  let toolCounter = 0
  let runCounter = 0

  for (let i = 0; i < messageCount; i++) {
    const role: SyntheticMessage["role"] = i % 2 === 0 ? "user" : "assistant"
    const baseText =
      role === "user"
        ? `User prompt ${i + 1}: ${LOREM.slice(0, 80 + Math.floor(rng() * 120))}`
        : `Assistant response ${i + 1}: ${LOREM} ${MARKDOWN_BLOCKS[i % MARKDOWN_BLOCKS.length]} ${LOREM.slice(0, 200 + Math.floor(rng() * 400))}`

    const msg: SyntheticMessage = {
      messageId: `msg-${i}`,
      role,
      text: baseText,
      createdAt: new Date(Date.now() - (messageCount - i) * 60000).toISOString(),
      openclawSeq: nextSeq++,
    }

    // Tool injection logic based on pattern
    let shouldInjectTool = false
    if (role === "assistant") {
      if (toolPattern === "sequential") {
        shouldInjectTool = i % Math.floor(1 / toolDensity) === 3
      } else if (toolPattern === "interleaved") {
        shouldInjectTool = rng() < toolDensity
      } else if (toolPattern === "burst") {
        const burstSize = Math.max(2, Math.floor(toolDensity * 10))
        shouldInjectTool = i % 20 < burstSize
      } else if (toolPattern === "random") {
        shouldInjectTool = rng() < toolDensity * 1.5
      }
    }

    if (shouldInjectTool && tools.length > 0) {
      const toolDef = tools[Math.floor(rng() * tools.length)]
      const runId = `run-${runCounter++}`
      const toolCall: SyntheticToolCall = {
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
            ? [{ type: "thinking" as const, text: `Thinking about ${toolDef.name}...` }]
            : []),
          { type: "toolCall" as const, id: toolCall.id, name: toolDef.name, input: toolDef.input },
        ]
      }

      msg.toolCalls = [toolCall]
      msg.runId = runId

      // Inject tool result message after assistant tool-call message
      if (includeContentBlocks && rng() < 0.7) {
        messages.push(msg)
        const resultMsg: SyntheticMessage = {
          messageId: `msg-${i}-result`,
          role: "toolResult",
          text: toolDef.result,
          createdAt: msg.createdAt,
          openclawSeq: nextSeq++,
          toolCalls: [
            {
              ...toolCall,
              id: `${toolCall.id}-result`,
              phase: "result",
            },
          ],
        }
        messages.push(resultMsg)
        continue
      }
    }

    // Optimistic user echo simulation
    if (includeOptimisticUser && role === "user" && rng() < 0.2) {
      msg.runId = `run:desktop-v2:agent:main:desktop:s1:idem-${i}`
    }

    messages.push(msg)
  }

  return messages
}

export function generate10x45Varied(): SyntheticMessage[][] {
  const configs: GeneratorOptions[] = [
    { messageCount: 45, toolDensity: 0.05, toolVariety: 3, toolPattern: "sequential", seed: 1 },
    { messageCount: 45, toolDensity: 0.1, toolVariety: 5, toolPattern: "interleaved", seed: 2 },
    { messageCount: 45, toolDensity: 0.2, toolVariety: 8, toolPattern: "burst", seed: 3 },
    { messageCount: 45, toolDensity: 0.15, toolVariety: 10, toolPattern: "random", seed: 4 },
    { messageCount: 45, toolDensity: 0.25, toolVariety: 6, toolPattern: "interleaved", includeReasoning: true, seed: 5 },
    { messageCount: 45, toolDensity: 0.1, toolVariety: 12, toolPattern: "sequential", includeContentBlocks: true, seed: 6 },
    { messageCount: 45, toolDensity: 0.18, toolVariety: 7, toolPattern: "burst", includeOptimisticUser: true, seed: 7 },
    { messageCount: 45, toolDensity: 0.12, toolVariety: 9, toolPattern: "random", includeReasoning: false, seed: 8 },
    { messageCount: 45, toolDensity: 0.3, toolVariety: 4, toolPattern: "interleaved", includeContentBlocks: false, seed: 9 },
    { messageCount: 45, toolDensity: 0.08, toolVariety: 15, toolPattern: "sequential", includeOptimisticUser: true, seed: 10 },
  ]
  return configs.map((cfg) => generateSyntheticMessages(cfg))
}
