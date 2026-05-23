import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import type { Message } from "../queries"
import type { ResolvedSender } from "../MessageActions"

vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({ data: {} }),
  useContact: () => ({ contact: undefined }),
  useDiscoverPath: () => ({ mutate: vi.fn(), isPending: false }),
}))

const useAuthInfoMock = vi.fn(() => ({
  data: { required: true, valid: true, public_base_url: "https://mesh.example.com" },
}))
vi.mock("@/features/auth/api", () => ({
  useAuthInfo: () => useAuthInfoMock(),
}))

vi.mock("../useSendMessage", () => ({
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("../queries", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../queries")
  return {
    ...actual,
    useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

// Import AFTER mocks.
import { MessageBubble } from "../MessageBubble"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

function inboundChannelMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    msg_type: "chan",
    contact_pub_key: null,
    channel_idx: 0,
    direction: "in",
    text: "Alice: hello",
    timestamp: "2026-05-22T10:00:00Z",
    ack_state: "received",
    pubkey_prefix: null,
    expected_ack_hex: null,
    ack_received_at: null,
    path: null,
    snr: null,
    rssi: null,
    ...overrides,
  }
}

function outboundChannelMessage(overrides: Partial<Message> = {}): Message {
  return inboundChannelMessage({
    id: 2,
    direction: "out",
    text: "my reply",
    ...overrides,
  })
}

function inboundDmMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 3,
    msg_type: "dm",
    contact_pub_key: "a".repeat(64),
    channel_idx: null,
    direction: "in",
    text: "hello DM",
    timestamp: "2026-05-22T10:00:00Z",
    ack_state: "received",
    pubkey_prefix: "abcd1234",
    expected_ack_hex: null,
    ack_received_at: null,
    path: null,
    snr: null,
    rssi: null,
    ...overrides,
  }
}

const aliceSender: ResolvedSender = {
  adv_name: "Alice",
  public_key: "deadbeef".padEnd(64, "0"),
}

function getSwipeRoot(): HTMLElement {
  // The bubble wrapper is tagged with data-swipe-root for the test.
  const node = document.querySelector("[data-swipe-root]")
  if (!node) throw new Error("data-swipe-root not found")
  return node as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("MessageBubble — swipe-to-reply", () => {
  it("fires onReply with sender name when inbound channel bubble swiped >= 50px", () => {
    const onReply = vi.fn()
    render(
      wrap(
        <MessageBubble
          message={inboundChannelMessage()}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={aliceSender}
          senderPrefix={null}
          displayText="hello"
          onReply={onReply}
        />,
      ),
    )
    const root = getSwipeRoot()
    fireEvent.pointerDown(root, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(root, { clientX: 80, pointerId: 1 })
    fireEvent.pointerUp(root, { clientX: 80, pointerId: 1 })
    expect(onReply).toHaveBeenCalledTimes(1)
    expect(onReply).toHaveBeenCalledWith("Alice")
  })

  it("does NOT fire onReply when swipe < 50px and resets transform", () => {
    const onReply = vi.fn()
    render(
      wrap(
        <MessageBubble
          message={inboundChannelMessage()}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={aliceSender}
          senderPrefix={null}
          displayText="hello"
          onReply={onReply}
        />,
      ),
    )
    const root = getSwipeRoot()
    fireEvent.pointerDown(root, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(root, { clientX: 20, pointerId: 1 })
    fireEvent.pointerUp(root, { clientX: 20, pointerId: 1 })
    expect(onReply).not.toHaveBeenCalled()
    // Transform should be reset to 0 after release.
    expect(root.style.transform).toMatch(/translateX\(0px\)/)
  })

  it("does NOT swipe outgoing bubbles", () => {
    const onReply = vi.fn()
    render(
      wrap(
        <MessageBubble
          message={outboundChannelMessage()}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={null}
          senderPrefix={null}
          onReply={onReply}
        />,
      ),
    )
    const root = getSwipeRoot()
    fireEvent.pointerDown(root, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(root, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(root, { clientX: 100, pointerId: 1 })
    expect(onReply).not.toHaveBeenCalled()
  })

  it("does NOT swipe DM bubbles (only channels)", () => {
    const onReply = vi.fn()
    render(
      wrap(
        <MessageBubble
          message={inboundDmMessage()}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={aliceSender}
          senderPrefix="abcd1234"
          onReply={onReply}
        />,
      ),
    )
    const root = getSwipeRoot()
    fireEvent.pointerDown(root, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(root, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(root, { clientX: 100, pointerId: 1 })
    expect(onReply).not.toHaveBeenCalled()
  })

  it("renders inline thumbnail for our /s/ URLs", () => {
    render(
      wrap(
        <MessageBubble
          message={inboundDmMessage({
            text: "look: https://mesh.example.com/s/aB3kZ9pX",
          })}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={null}
          senderPrefix={null}
        />,
      ),
    )
    const img = document.querySelector("img") as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.getAttribute("src")).toBe(
      "https://mesh.example.com/i/aB3kZ9pX/thumb",
    )
    // Body text + the URL must still render (recipients copy/share it). The
    // URL itself is autolinked by `renderMentions` into a separate <a>, so
    // assert presence of the prefix text and the autolinked anchor independently.
    expect(screen.getByText(/look:/)).toBeTruthy()
    const urlAnchor = Array.from(document.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "https://mesh.example.com/s/aB3kZ9pX",
    )
    expect(urlAnchor).toBeTruthy()
  })

  it("does not render thumb for foreign hosts", () => {
    render(
      wrap(
        <MessageBubble
          message={inboundDmMessage({
            text: "sketchy: https://evil.com/s/aB3kZ9pX",
          })}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={null}
          senderPrefix={null}
        />,
      ),
    )
    expect(document.querySelector("img")).toBeNull()
  })

  it("does NOT initiate swipe when pointerdown originates on a button", () => {
    const onReply = vi.fn()
    render(
      wrap(
        <MessageBubble
          message={inboundChannelMessage()}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={aliceSender}
          senderPrefix={null}
          displayText="hello"
          onReply={onReply}
        />,
      ),
    )
    const moreActionsBtn = screen.getByRole("button", { name: /message actions/i })
    fireEvent.pointerDown(moreActionsBtn, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(moreActionsBtn, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(moreActionsBtn, { clientX: 100, pointerId: 1 })
    expect(onReply).not.toHaveBeenCalled()
  })
})
