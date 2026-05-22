import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { useState } from "react"

vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({ data: {} }),
  useContact: () => ({ contact: undefined }),
}))

vi.mock("@/features/channels/queries", () => ({
  useChannels: () => ({ data: [] }),
}))

const sendMutate = vi.fn()
vi.mock("../useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMutate, isPending: false }),
}))

// Import AFTER mocks.
import { MessageInput } from "../MessageInput"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  sendMutate.mockReset()
})

describe("MessageInput — uncontrolled (default) behaviour", () => {
  it("typing into the textarea updates its own internal state", () => {
    render(wrap(<MessageInput channelIdx={0} />))
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "hi there" } })
    expect(textarea.value).toBe("hi there")
  })
})

describe("MessageInput — controlled mode", () => {
  function Controlled({ initial = "" }: { initial?: string }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <div data-testid="parent-value">{value}</div>
        <MessageInput channelIdx={0} value={value} onChange={setValue} />
      </>
    )
  }

  it("edits propagate to parent onChange", () => {
    render(wrap(<Controlled />))
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "ping" } })
    expect(screen.getByTestId("parent-value").textContent).toBe("ping")
    expect(textarea.value).toBe("ping")
  })
})

describe("MessageInput — seedKey focus bump", () => {
  function Harness() {
    const [value, setValue] = useState("")
    const [seedKey, setSeedKey] = useState(0)
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setValue("@Alice ")
            setSeedKey((k) => k + 1)
          }}
        >
          seed
        </button>
        <MessageInput
          channelIdx={0}
          value={value}
          onChange={setValue}
          seedKey={seedKey}
        />
      </>
    )
  }

  it("focuses the textarea and reflects the new value when seedKey bumps", () => {
    render(wrap(<Harness />))
    const seedBtn = screen.getByRole("button", { name: /seed/i })
    act(() => {
      fireEvent.click(seedBtn)
    })
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    expect(textarea.value).toBe("@Alice ")
    expect(document.activeElement).toBe(textarea)
  })
})
