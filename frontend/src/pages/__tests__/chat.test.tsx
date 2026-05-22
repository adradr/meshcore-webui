import type React from "react"
import { useState } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import type { Message } from "@/features/chat/queries"
import type { ResolvedSender } from "@/features/chat/MessageActions"

// ----- Mocks ---------------------------------------------------------------
vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({ data: {} }),
  useContact: () => ({ contact: undefined }),
  useDiscoverPath: () => ({ mutate: vi.fn(), isPending: false }),
  // Pulled in by the AttachmentMenu adornment now rendered inside the
  // composer; keep it inert so this integration test stays focused on
  // the swipe-to-reply behaviour.
  useShareContact: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@/features/device/queries", () => ({
  useSelfInfo: () => ({ data: undefined }),
}))

vi.mock("@/features/chat/ShareLocationMapDialog", () => ({
  ShareLocationMapDialog: () => null,
}))

vi.mock("@/features/channels/queries", () => ({
  useChannels: () => ({ data: [{ channel_idx: 0, channel_name: "Public" }] }),
}))

vi.mock("@/features/chat/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@/features/chat/queries", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/features/chat/queries",
  )
  return {
    ...actual,
    useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

// Import AFTER mocks.
import { MessageBubble } from "@/features/chat/MessageBubble"
import { MessageInput } from "@/features/chat/MessageInput"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

function inboundChannelMessage(): Message {
  return {
    id: 1,
    msg_type: "chan",
    contact_pub_key: null,
    channel_idx: 0,
    direction: "in",
    text: "Alice: hello team",
    timestamp: "2026-05-22T10:00:00Z",
    ack_state: "received",
    pubkey_prefix: null,
    expected_ack_hex: null,
    ack_received_at: null,
    path: null,
    snr: null,
    rssi: null,
  }
}

const aliceSender: ResolvedSender = {
  adv_name: "Alice",
  public_key: "deadbeef".padEnd(64, "0"),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Chat integration — swipe-to-reply prefills @Sender into composer", () => {
  function Harness() {
    const [draft, setDraft] = useState("")
    const [seedKey, setSeedKey] = useState(0)
    const handleReply = (senderName: string) => {
      setDraft((d) => (d.trim() ? `${d} @${senderName} ` : `@${senderName} `))
      setSeedKey((k) => k + 1)
    }
    return (
      <>
        <MessageBubble
          message={inboundChannelMessage()}
          isFirstInGroup
          isLastInGroup
          showStatus={false}
          resolvedSender={aliceSender}
          senderPrefix={null}
          displayText="hello team"
          onReply={handleReply}
        />
        <MessageInput
          channelIdx={0}
          value={draft}
          onChange={setDraft}
          seedKey={seedKey}
        />
      </>
    )
  }

  it("swiping the Alice bubble prefills @Alice and focuses composer", () => {
    render(wrap(<Harness />))
    const root = document.querySelector("[data-swipe-root]") as HTMLElement
    expect(root).toBeTruthy()
    act(() => {
      fireEvent.pointerDown(root, { clientX: 0, pointerId: 1 })
      fireEvent.pointerMove(root, { clientX: 80, pointerId: 1 })
      fireEvent.pointerUp(root, { clientX: 80, pointerId: 1 })
    })
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    expect(textarea.value).toBe("@Alice ")
    expect(document.activeElement).toBe(textarea)
  })
})
