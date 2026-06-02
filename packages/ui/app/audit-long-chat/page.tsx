"use client"

import { useMemo } from "react"
import { OpenClawVercelChat } from "@/components/ChatView/vercel-ui/OpenClawVercelChat"
import type { ChatMessage } from "@/components/ChatView/types"

const MESSAGE_COUNT = 2000

function generateMessages(): ChatMessage[] {
  const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
  const markdown = [
    "**Bold result** with _italic note_ and normal text.",
    "```ts\nconst stable = true\nconsole.log(stable)\n```",
    "- first item\n- second item\n- third item",
    "> quoted context line for layout testing",
  ]

  return Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant"
    const turn = Math.floor(index / 2)
    return {
      messageId: `audit-msg-${index}`,
      role,
      text:
        role === "user"
          ? `User prompt ${turn}: repeated stress prompt ${turn % 25}. ${lorem} ${"extra ".repeat(index % 12)}`
          : `Assistant response ${turn}: ${lorem}\n\n${markdown[index % markdown.length]}\n\n${lorem} ${"detail ".repeat(20 + (index % 30))}`,
      createdAt: new Date(1_780_000_000_000 + index * 1000).toISOString(),
      gatewayIndex: index,
      toolCalls:
        role === "assistant" && index % 13 === 1
          ? [
              {
                id: `audit-tool-${index}`,
                tool: "exec",
                status: "success",
                duration: "0.2s",
                input: { command: "echo audit" },
                resultText: "audit",
              },
            ]
          : undefined,
    } satisfies ChatMessage
  })
}

export default function AuditLongChatPage() {
  const messages = useMemo(generateMessages, [])

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground" data-audit-real-webui="true">
      <OpenClawVercelChat
        sessionKey="audit-real-webui-long-chat"
        messages={messages}
        isGenerating={false}
        hasOlderMessages={false}
      />
    </main>
  )
}
