import {
  mergeCommandMessages,
  type HistMsg,
} from "../../services/chat.service.js"

function user(id: string, text: string): HistMsg {
  return { id, role: "user", text, content: [{ type: "text", text }] }
}

function injected(id: string, text: string): HistMsg {
  return {
    id,
    role: "assistant",
    text,
    content: [{ type: "text", text }],
    model: "gateway-injected",
  }
}

describe("mergeCommandMessages", () => {
  it("places model commands beside their own injected replies", () => {
    const messages: HistMsg[] = [
      user("gw_cmd_old", "/model openai-codex/gpt-5.4"),
      injected(
        "model_info",
        "Current: openai-codex/gpt-5.5\nSwitch: /model <provider/model>\nBrowse: /models",
      ),
      user("u1", "hello"),
      { id: "a1", role: "assistant", text: "Hi", model: "gpt-5.5" },
      injected("set_54", "Model set to openai-codex/gpt-5.4."),
      injected("set_55", "Model set to codex/gpt-5.5."),
    ]

    const merged = mergeCommandMessages(messages, [
      {
        id: "cmd_set_54",
        text: "/model openai-codex/gpt-5.4",
        created_at: "2026-04-30T04:00:00.000Z",
      },
      {
        id: "cmd_info",
        text: "/model",
        created_at: "2026-04-30T04:01:00.000Z",
      },
      {
        id: "cmd_set_55",
        text: "/model codex/gpt-5.5",
        created_at: "2026-04-30T04:02:00.000Z",
      },
    ])

    expect(merged.map((msg) => msg.id)).toEqual([
      "cmd_info",
      "model_info",
      "u1",
      "a1",
      "cmd_set_54",
      "set_54",
      "cmd_set_55",
      "set_55",
    ])
  })

  it("falls back to the next saved command for unknown injected replies", () => {
    const messages: HistMsg[] = [
      user("existing_cmd", "/already-present"),
      injected("already_paired", "Already paired reply"),
      injected("unknown_reply", "Custom command response"),
    ]

    const merged = mergeCommandMessages(messages, [
      {
        id: "cmd_unknown",
        text: "/unknown",
        created_at: "2026-04-30T04:03:00.000Z",
      },
    ])

    expect(merged.map((msg) => msg.id)).toEqual([
      "existing_cmd",
      "already_paired",
      "cmd_unknown",
      "unknown_reply",
    ])
  })
})
