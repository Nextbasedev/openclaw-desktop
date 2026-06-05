import { describe, expect, it, vi } from "vitest"
import { LoadOlderMessagesButton } from "@/components/ChatView/LoadOlderMessagesButton"

describe("LoadOlderMessagesButton", () => {
  it("renders a fallback affordance when older messages exist and calls load older", () => {
    const onLoadOlderMessages = vi.fn()
    const element = LoadOlderMessagesButton({
      hasOlderMessages: true,
      loadingOlderMessages: false,
      onLoadOlderMessages,
    })

    expect(element).not.toBeNull()
    const button = Array.isArray(element!.props.children)
      ? element!.props.children[0]
      : element!.props.children
    expect(button.props.children).toBe("Load older messages")

    button.props.onClick()
    expect(onLoadOlderMessages).toHaveBeenCalledTimes(1)
  })

  it("does not render when all history is loaded", () => {
    expect(LoadOlderMessagesButton({
      hasOlderMessages: false,
      loadingOlderMessages: false,
      onLoadOlderMessages: vi.fn(),
    })).toBeNull()
  })
})
