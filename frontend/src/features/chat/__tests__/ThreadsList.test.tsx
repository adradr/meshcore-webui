import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import type { Thread } from "../queries"
import type { Channel } from "@/features/channels/queries"

// Module-level hooks so each test can swap the data per case without
// re-mocking the module (vi.mock is hoisted, so it must use a factory
// that closes over mutable bindings).
const threadsState: { data: Thread[] | undefined; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
}
const channelsState: { data: Channel[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
}

vi.mock("../queries", () => ({
  useThreads: () => threadsState,
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  useUnreadTotal: () => ({ data: { total: 0 } }),
}))

vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({ data: {} }),
}))

vi.mock("@/features/channels/queries", () => ({
  useChannels: () => channelsState,
}))

// Import AFTER mocks are declared.
import { ThreadsList } from "../ThreadsList"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

function dm(pk: string, text = "hello"): Thread {
  return {
    msg_type: "dm",
    contact_pub_key: pk,
    channel_idx: null,
    last_text: text,
    last_timestamp: "2026-05-21T10:00:00Z",
    last_direction: "in",
    unread_count: 0,
  }
}

function chan(idx: number, text = "hey"): Thread {
  return {
    msg_type: "chan",
    contact_pub_key: null,
    channel_idx: idx,
    last_text: text,
    last_timestamp: "2026-05-21T10:00:00Z",
    last_direction: "in",
    unread_count: 0,
  }
}

function ch(idx: number, name: string): Channel {
  return { channel_idx: idx, channel_name: name }
}

beforeEach(() => {
  threadsState.data = []
  threadsState.isLoading = false
  threadsState.isError = false
  channelsState.data = []
  channelsState.isLoading = false
})

describe("ThreadsList — channel filter", () => {
  it("renders channel threads when their idx is in the radio's channel list", () => {
    threadsState.data = [chan(2, "live message")]
    channelsState.data = [ch(2, "Public")]

    render(wrap(<ThreadsList />))

    expect(screen.getByText("# Public")).toBeInTheDocument()
    expect(screen.getByText("live message")).toBeInTheDocument()
  })

  it("hides channel threads whose idx is NOT in the radio's channel list", () => {
    // Thread for channel 2 in the DB, but the radio only reports channel 0.
    threadsState.data = [chan(2, "orphan channel message")]
    channelsState.data = [ch(0, "Public")]

    render(wrap(<ThreadsList />))

    expect(screen.queryByText("orphan channel message")).not.toBeInTheDocument()
    // No items at all -> empty-state copy renders.
    expect(
      screen.getByText(/No conversations yet/i),
    ).toBeInTheDocument()
  })

  it("keeps DM threads even when the channels list is empty", () => {
    // Channels list is loaded (data === []), not undefined. DMs must
    // still pass the filter — only channel threads are subject to it.
    threadsState.data = [dm("a".repeat(64), "direct hello")]
    channelsState.data = []

    render(wrap(<ThreadsList />))

    expect(screen.getByText("direct hello")).toBeInTheDocument()
  })

  it("does not filter while the channels query is still loading", () => {
    // While `channels.data === undefined` we must NOT drop channel
    // threads, otherwise the initial paint flashes empty.
    threadsState.data = [chan(2, "loading channel message")]
    channelsState.data = undefined
    channelsState.isLoading = true

    render(wrap(<ThreadsList />))

    expect(screen.getByText("loading channel message")).toBeInTheDocument()
  })
})
