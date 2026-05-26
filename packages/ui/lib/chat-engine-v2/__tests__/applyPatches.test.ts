import { describe, expect, test } from "vitest"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "../applyPatches"
import { dedupeChatMessages } from "../../chatMessageDedupe"

describe("applyChatPatch", () => {
  test("ignores idle runStatus on plain message upsert without active run", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          projectionVersion: 3,
          semanticType: "chat.message.upsert",
          runStatus: "idle",
          status: "idle",
          activeRun: null,
          message: { role: "user", text: "gateway echo" },
        },
        createdAtMs: 1,
      },
    })).toBeNull()
  })

  test("still accepts assistant final done status from message upsert", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          projectionVersion: 3,
          semanticType: "chat.assistant.final",
          runStatus: "done",
          status: "done",
          activeRun: null,
          message: { role: "assistant", text: "answer" },
        },
        createdAtMs: 2,
      },
    })).toMatchObject({ status: "done" })
  })

  test("ignores stale cursors", () => {
    const state = { cursor: 2, messages: [] }
    const next = applyChatPatch(state, {
      type: "patch",
      patch: { cursor: 1, type: "chat.message.upsert", sessionKey: "s1", payload: { message: { role: "user", text: "old", id: "m1" } }, createdAtMs: 1 },
    })
    expect(next).toBe(state)
  })

  test("appends chat.message.upsert payload", () => {
    const next = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: { cursor: 1, type: "chat.message.upsert", sessionKey: "s1", payload: { message: { role: "user", text: "hello", id: "m1" } }, createdAtMs: 1 },
    })
    expect(next.cursor).toBe(1)
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({ messageId: "m1", role: "user", text: "hello" })
  })

  test("merges sequential tool-only assistant patches into one visible steps block", () => {
    const withFirstTool = applyChatPatch({ cursor: 0, messages: [
      { messageId: "u1", role: "user", text: "run tools" },
    ] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          runStatus: "tool_running",
          statusLabel: "read",
          activeRun: { status: "tool_running" },
          message: { role: "assistant", content: [{ type: "toolCall", id: "tc-read", name: "read", input: { path: "A.md" } }] },
        },
        createdAtMs: 1,
      },
    })

    const withSecondTool = applyChatPatch(withFirstTool, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          runStatus: "tool_running",
          statusLabel: "session_status",
          activeRun: { status: "tool_running" },
          message: { role: "assistant", content: [{ type: "toolCall", id: "tc-status", name: "session_status", input: {} }] },
        },
        createdAtMs: 2,
      },
    })

    expect(withSecondTool.messages).toHaveLength(2)
    expect(withSecondTool.messages[1]).toMatchObject({
      role: "assistant",
      text: "",
      toolCalls: [
        { id: "tc-read", tool: "read" },
        { id: "tc-status", tool: "session_status" },
      ],
    })
  })

  test("uses stable OpenClaw ids so replayed patches do not duplicate history", () => {
    const state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "assistant", text: "hel", __openclaw: { id: "oc_2", seq: 2 } } },
        createdAtMs: 1,
      },
    })
    const next = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "assistant", text: "hello", __openclaw: { id: "oc_2", seq: 2 } } },
        createdAtMs: 2,
      },
    })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({ messageId: "oc_2", role: "assistant", text: "hello" })
  })

  test("marks live assistant websocket text updates for smooth reveal", () => {
    const state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.assistant.delta",
          messageId: "assistant-1",
          message: { role: "assistant", text: "Hel", __openclaw: { id: "assistant-1", seq: 2 } },
        },
        createdAtMs: 1,
      },
    })
    expect(state.messages[0]).toMatchObject({
      messageId: "assistant-1",
      role: "assistant",
      text: "Hel",
      animateText: true,
    })

    const next = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.assistant.delta",
          messageId: "assistant-1",
          message: { role: "assistant", text: "Hello smooth stream", __openclaw: { id: "assistant-1", seq: 2 } },
        },
        createdAtMs: 2,
      },
    })
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]).toMatchObject({
      messageId: "assistant-1",
      role: "assistant",
      text: "Hello smooth stream",
      animateText: true,
    })
  })

  test("marks V2 send patches as optimistic so later gateway user echoes dedupe", () => {
    const optimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "third", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client:key", seq: 0 } } },
        createdAtMs: 1,
      },
    }).messages
    const gatewayEcho = applyChatPatch({ cursor: 1, messages: optimistic }, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "third", __openclaw: { id: "oc_3", seq: 3 } } },
        createdAtMs: 2,
      },
    }).messages
    expect(gatewayEcho).toHaveLength(1)
    expect(gatewayEcho[0]).toMatchObject({ role: "user", text: "third" })
  })

  test("atomically confirms optimistic client message with Gateway echo", () => {
    const withOptimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "byy", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client:key" } } },
        createdAtMs: 1,
      },
    })
    const confirmed = applyChatPatch(withOptimistic, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: { optimisticId: "client:key", message: { role: "user", text: "byy", __openclaw: { id: "oc_4", seq: 4 } } },
        createdAtMs: 2,
      },
    })
    expect(confirmed.messages).toHaveLength(1)
    expect(confirmed.messages[0]).toMatchObject({ messageId: "client:key", role: "user", text: "byy", isOptimistic: false })
  })

  test("confirms optimistic user without hiding it when Gateway echo is blank", () => {
    const withOptimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.created",
          messageId: "client-1",
          message: { role: "user", text: "hii", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1" } },
        },
        createdAtMs: 1,
      },
    })
    const confirmed = applyChatPatch(withOptimistic, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.confirmed",
          messageId: "client-1",
          optimisticId: "client-1",
          gatewayMessageId: "gateway-blank",
          messageSeq: 2,
          message: { role: "user", __openclaw: { id: "gateway-blank", seq: 2 } },
        },
        createdAtMs: 2,
      },
    })

    expect(confirmed.messages).toHaveLength(1)
    expect(confirmed.messages[0]).toMatchObject({ messageId: "client-1", role: "user", text: "hii", isOptimistic: false, gatewayIndex: 2 })
  })

  test("does not merge a reused tool id into a completed tool after a new user turn", () => {
    let state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.assistant.final",
          messageId: "assistant-1",
          message: { role: "assistant", text: "done", toolCalls: [{ id: "tool-1", tool: "read", status: "success", duration: "0.5s" }] },
        },
        createdAtMs: 1,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.created", optimistic: true, messageId: "client-2", message: { role: "user", text: "again", isOptimistic: true } },
        createdAtMs: 2,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.tool.started",
          runStatus: "tool_running",
          messageId: "tool-live-2",
          message: { role: "assistant", text: "checking", content: [{ type: "tool_call", id: "tool-1", name: "read", phase: "start" }] },
        },
        createdAtMs: 3,
      },
    })

    expect(state.messages.map((message) => message.role)).toEqual(["assistant", "user", "assistant"])
    expect(state.messages[0]?.toolCalls?.[0]).toMatchObject({ id: "tool-1", status: "success" })
    expect(state.messages[2]).toMatchObject({ role: "assistant", text: "checking" })
    expect(state.messages[2]?.toolCalls?.[0]).toMatchObject({ id: "tool-1", status: "running" })
  })

  test("does not let same-message backfill downgrade completed tools to running", () => {
    let state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.message.upsert",
          messageId: "assistant-tools",
          message: {
            role: "assistant",
            toolCalls: [{ id: "tool-1", tool: "session_status", status: "success", duration: "0.5s" }],
            __openclaw: { id: "assistant-tools", seq: 2 },
          },
        },
        createdAtMs: 1,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.message.upsert",
          messageId: "assistant-tools",
          message: {
            role: "assistant",
            toolCalls: [{ id: "tool-1", tool: "session_status", status: "running" }],
            __openclaw: { id: "assistant-tools", seq: 2 },
          },
        },
        createdAtMs: 2,
      },
    })

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.toolCalls?.[0]).toMatchObject({ id: "tool-1", status: "success", duration: "0.5s" })
  })

  test("does not replace current optimistic user with a stale confirmed user echo", () => {
    const withOptimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.created", messageId: "client-1", message: { role: "user", text: "good night now", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1" } } },
        createdAtMs: 1,
      },
    })
    const confirmed = applyChatPatch(withOptimistic, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.confirmed", messageId: "client-1", optimisticId: "client-1", gatewayMessageId: "gateway-stale", message: { role: "user", text: "byy", __openclaw: { id: "gateway-stale", seq: 4 } } },
        createdAtMs: 2,
      },
    })
    expect(confirmed.cursor).toBe(2)
    expect(confirmed.messages).toHaveLength(1)
    expect(confirmed.messages[0]).toMatchObject({ messageId: "client-1", role: "user", text: "good night now" })
  })


  test("keeps optimistic user attachment previews when confirmed patch omits attachments", () => {
    const withOptimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.created",
          messageId: "client-1",
          message: {
            role: "user",
            text: "look",
            attachments: [{ name: "image.png", mimeType: "image/png", content: "abc123" }],
            isOptimistic: true,
            __clientOptimistic: true,
            __openclaw: { id: "client-1" },
          },
        },
        createdAtMs: 1,
      },
    })

    const confirmed = applyChatPatch(withOptimistic, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.confirmed",
          messageId: "client-1",
          optimisticId: "client-1",
          message: {
            role: "user",
            text: "look",
            __openclaw: { id: "gateway-1", seq: 1 },
          },
        },
        createdAtMs: 2,
      },
    })

    expect(confirmed.messages).toHaveLength(1)
    expect(confirmed.messages[0]).toMatchObject({
      messageId: "client-1",
      role: "user",
      text: "look",
      attachments: [{ name: "image.png", mimeType: "image/png", content: "abc123" }],
    })
  })

  test("applies semantic confirmed user patch by canonical client id", () => {
    const withOptimistic = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.created", messageId: "client-1", message: { role: "user", text: "hello", isOptimistic: true, __openclaw: { id: "client-1" } } },
        createdAtMs: 1,
      },
    })
    const confirmed = applyChatPatch(withOptimistic, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.confirmed", messageId: "client-1", optimisticId: "client-1", gatewayMessageId: "gateway-1", message: { role: "user", text: "hello", __openclaw: { id: "gateway-1", seq: 4 } } },
        createdAtMs: 2,
      },
    })
    expect(confirmed.messages).toHaveLength(1)
    expect(confirmed.messages[0]).toMatchObject({ messageId: "client-1", role: "user", text: "hello", isOptimistic: false })
  })

  test("keeps consecutive sends in seq order when an earlier assistant final arrives late", () => {
    let state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.created", messageId: "client-1", messageSeq: 1, message: { role: "user", text: "hii what is your name", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1", seq: 1 } } },
        createdAtMs: 1,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.created", messageId: "client-2", messageSeq: 3, message: { role: "user", text: "ella you are my bff", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-2", seq: 3 } } },
        createdAtMs: 2,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 3,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.assistant.final", messageId: "assistant-1", messageSeq: 2, message: { role: "assistant", text: "My name is Ella.", __openclaw: { id: "assistant-1", seq: 2 } } },
        createdAtMs: 3,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 4,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: { semanticType: "chat.user.confirmed", messageId: "client-2", optimisticId: "client-2", gatewayMessageId: "gateway-user-2", messageSeq: 3, message: { role: "user", text: "ella you are my bff", __openclaw: { id: "gateway-user-2", seq: 3 } } },
        createdAtMs: 4,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 5,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { semanticType: "chat.assistant.final", messageId: "assistant-2", messageSeq: 4, message: { role: "assistant", text: "Aww, bff status accepted.", __openclaw: { id: "assistant-2", seq: 4 } } },
        createdAtMs: 5,
      },
    })

    expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      "user:hii what is your name",
      "assistant:My name is Ella.",
      "user:ella you are my bff",
      "assistant:Aww, bff status accepted.",
    ])
    expect(state.messages.filter((message) => message.role === "user" && message.text === "ella you are my bff")).toHaveLength(1)
    expect(state.messages[2]).toMatchObject({ messageId: "client-2", isOptimistic: false })
  })

  test("merges canonical gateway user into confirmed optimistic user by sequence when ids differ", () => {
    const text = "fastqa2 B 1778517449764"
    let state = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 107,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.created",
          messageId: "client-b",
          message: {
            role: "user",
            text,
            isOptimistic: true,
            __clientOptimistic: true,
            __openclaw: { id: "client-b", clientMessageId: "client-b" },
          },
          optimistic: true,
        },
        createdAtMs: 1,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 109,
        type: "chat.message.confirmed",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.user.confirmed",
          messageId: "client-b",
          optimisticId: "client-b",
          clientMessageId: "client-b",
          messageSeq: 3,
          message: {
            role: "user",
            content: text,
            __openclaw: { id: "client-b", seq: 2, gatewayId: null, gatewaySeq: 2 },
            isOptimistic: false,
            __clientOptimistic: false,
          },
        },
        createdAtMs: 2,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 113,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.message.upsert",
          messageId: "gateway-b",
          messageSeq: 3,
          message: {
            role: "user",
            content: [{ type: "text", text: `Sender (untrusted metadata):\n\`\`\`json\n{\n  \"id\": \"gateway-client\"\n}\n\`\`\`\n\n[Mon 2026-05-11 16:37 UTC] ${text}` }],
            timestamp: 1778517465974,
            __openclaw: { id: "gateway-b", seq: 3 },
          },
        },
        createdAtMs: 3,
      },
    })
    state = applyChatPatch(state, {
      type: "patch",
      patch: {
        cursor: 114,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: {
          semanticType: "chat.assistant.final",
          messageId: "assistant-b",
          messageSeq: 4,
          message: { role: "assistant", text, __openclaw: { id: "assistant-b", seq: 4 } },
        },
        createdAtMs: 4,
      },
    })

    expect(state.messages.map((message) => `${message.role}:${message.text}`)).toEqual([
      `user:${text}`,
      `assistant:${text}`,
    ])
    expect(state.messages.filter((message) => message.role === "user" && message.text === text)).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ messageId: "gateway-b", role: "user", gatewayIndex: 3, isOptimistic: false })
  })

  test("extracts V2 status patches for cross-tab thinking", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: { cursor: 1, type: "chat.status", sessionKey: "s1", payload: { status: "thinking", statusLabel: "Thinking" }, createdAtMs: 1 },
    })).toEqual({ status: "thinking", label: "Thinking" })
  })

  test("extracts terminal status from session.upsert patches", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: { cursor: 1, type: "session.upsert", sessionKey: "s1", payload: { status: "done" }, createdAtMs: 1 },
    })).toEqual({ status: "done", label: null })
  })

  test("extracts canonical runStatus patches", () => {
    expect(statusFromPatch({
      type: "patch",
      patch: { cursor: 1, type: "chat.tool.result", sessionKey: "s1", payload: { semanticType: "chat.tool.result", runStatus: "tool_running", statusLabel: "exec" }, createdAtMs: 1 },
    })).toEqual({ status: "tool_running", label: "exec" })
  })

  test("treats optimistic user patches as legacy defensive active run signals", () => {
    expect(patchImpliesActiveRun({
      type: "patch",
      patch: { cursor: 1, type: "chat.message.upsert", sessionKey: "s1", payload: { optimistic: true, message: { role: "user", text: "hi" } }, createdAtMs: 1 },
    })).toBe(true)
  })

  test("merges bootstrap history and patch messages with the same OpenClaw id", () => {
    const bootstrap = applyChatPatch({ cursor: 0, messages: [] }, {
      type: "patch",
      patch: {
        cursor: 1,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "first", __openclaw: { id: "oc_1", seq: 1 } } },
        createdAtMs: 1,
      },
    }).messages
    const replay = applyChatPatch({ cursor: 1, messages: bootstrap }, {
      type: "patch",
      patch: {
        cursor: 2,
        type: "chat.message.upsert",
        sessionKey: "s1",
        payload: { message: { role: "user", text: "first", __openclaw: { id: "oc_1", seq: 1 } } },
        createdAtMs: 2,
      },
    }).messages
    expect(dedupeChatMessages([...bootstrap, ...replay])).toHaveLength(1)
  })
})
