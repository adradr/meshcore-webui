import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { AttachmentListOut } from "@/features/attachments/types"

// Per-test knob for the mocked TanStack Query hook. Reassigning before
// render lets each test pick the loading / empty / populated branch
// without juggling a real QueryClient.
let listState: {
  data?: AttachmentListOut
  isLoading: boolean
} = { isLoading: true }

vi.mock("@/features/attachments/queries", () => ({
  useAttachments: () => listState,
}))

import { AttachmentsManager } from "../AttachmentsManager"

function makeList(
  overrides: Partial<AttachmentListOut> = {},
): AttachmentListOut {
  return {
    items: [],
    next_cursor: null,
    total_count: 0,
    total_bytes: 0,
    quota_bytes: 100 * 1024 * 1024,
    ...overrides,
  }
}

function renderManager() {
  return render(
    <MemoryRouter>
      <AttachmentsManager />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listState = { isLoading: true }
})

describe("AttachmentsManager (Settings summary card)", () => {
  it("shows a loading summary while the list query is pending", () => {
    listState = { isLoading: true }
    renderManager()
    expect(screen.getByTestId("attachments-summary")).toHaveTextContent(
      /Loading/,
    )
  })

  it("shows the 'No attachments yet' line when the list is empty", () => {
    listState = { isLoading: false, data: makeList() }
    renderManager()
    expect(screen.getByTestId("attachments-summary")).toHaveTextContent(
      /No attachments yet/,
    )
  })

  it("shows aggregate count + bytes when the list has items", () => {
    listState = {
      isLoading: false,
      data: makeList({
        total_count: 3,
        total_bytes: 2_201_024,
      }),
    }
    renderManager()
    expect(screen.getByTestId("attachments-summary")).toHaveTextContent(
      /3 attachments/,
    )
    expect(screen.getByTestId("attachments-summary")).toHaveTextContent(
      /MB|KB|B/,
    )
  })

  it("renders a 'Manage attachments' link that points at /attachments", () => {
    listState = { isLoading: false, data: makeList() }
    renderManager()
    const link = screen.getByRole("link", { name: /Manage attachments/i })
    expect(link).toHaveAttribute("href", "/attachments")
  })
})
