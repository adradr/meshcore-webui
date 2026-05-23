import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { AttachmentListOut } from "@/features/attachments/types"

// Per-test knobs for the mocked TanStack Query hooks. Reassigning these
// before render lets each test pick the loading / empty / populated branch
// without juggling a real QueryClient.
let listState: {
  data?: AttachmentListOut
  isLoading: boolean
} = { isLoading: true }
const deleteMutate = vi.fn()
const purgeMutate = vi.fn()

vi.mock("@/features/attachments/queries", () => ({
  useAttachments: () => listState,
  useDeleteAttachment: () => ({ mutate: deleteMutate, isPending: false }),
  usePurgeAttachments: () => ({ mutate: purgeMutate, isPending: false }),
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

beforeEach(() => {
  vi.clearAllMocks()
  listState = { isLoading: true }
})

describe("AttachmentsManager", () => {
  it("shows a loading state while the list query is pending", () => {
    listState = { isLoading: true }
    render(<AttachmentsManager />)
    expect(screen.getByTestId("attachments-loading")).toBeInTheDocument()
  })

  it("shows an empty state when the list resolves with zero items", () => {
    listState = { isLoading: false, data: makeList() }
    render(<AttachmentsManager />)
    expect(screen.getByTestId("attachments-empty")).toBeInTheDocument()
    // Purge button is hidden when there's nothing to purge.
    expect(
      screen.queryByRole("button", { name: /^Purge…$/ }),
    ).not.toBeInTheDocument()
  })

  it("renders a grid card per item with slug, size, and a Delete button", () => {
    listState = {
      isLoading: false,
      data: makeList({
        items: [
          {
            slug: "aB3kZ9pX",
            url: "https://x/s/aB3kZ9pX",
            thumb_url: "https://x/i/aB3kZ9pX/thumb",
            mime: "image/webp",
            size_bytes: 2_200_000,
            width: 800,
            height: 600,
            original_filename: "shot.png",
            uploaded_at: new Date().toISOString(),
          },
          {
            slug: "qZ7mN1tY",
            url: "https://x/s/qZ7mN1tY",
            thumb_url: "https://x/i/qZ7mN1tY/thumb",
            mime: "image/webp",
            size_bytes: 1024,
            width: 100,
            height: 100,
            original_filename: null,
            uploaded_at: new Date().toISOString(),
          },
        ],
        total_count: 2,
        total_bytes: 2_201_024,
      }),
    }
    render(<AttachmentsManager />)

    expect(screen.getByTestId("attachments-grid")).toBeInTheDocument()
    expect(screen.getByTestId("attachment-card-aB3kZ9pX")).toBeInTheDocument()
    expect(screen.getByTestId("attachment-card-qZ7mN1tY")).toBeInTheDocument()

    // Slugs render in mono.
    expect(screen.getByText("aB3kZ9pX")).toBeInTheDocument()
    expect(screen.getByText("qZ7mN1tY")).toBeInTheDocument()

    // Header counter / quota line shows up.
    expect(screen.getByText(/2 files/i)).toBeInTheDocument()

    // Purge button surfaces when populated.
    expect(
      screen.getByRole("button", { name: /^Purge…$/ }),
    ).toBeInTheDocument()
  })

  it("clicking a card's trash button calls useDeleteAttachment.mutate(slug)", () => {
    listState = {
      isLoading: false,
      data: makeList({
        items: [
          {
            slug: "aB3kZ9pX",
            url: "https://x/s/aB3kZ9pX",
            thumb_url: "https://x/i/aB3kZ9pX/thumb",
            mime: "image/webp",
            size_bytes: 2_200_000,
            width: 800,
            height: 600,
            original_filename: null,
            uploaded_at: new Date().toISOString(),
          },
        ],
        total_count: 1,
        total_bytes: 2_200_000,
      }),
    }
    render(<AttachmentsManager />)

    const trash = screen.getByRole("button", { name: /Delete aB3kZ9pX/ })
    fireEvent.click(trash)
    expect(deleteMutate).toHaveBeenCalledTimes(1)
    expect(deleteMutate).toHaveBeenCalledWith("aB3kZ9pX")
  })

  it("clicking 'Purge…' opens the PurgeConfirmModal (renders its title)", () => {
    listState = {
      isLoading: false,
      data: makeList({
        items: [
          {
            slug: "aB3kZ9pX",
            url: "https://x/s/aB3kZ9pX",
            thumb_url: "https://x/i/aB3kZ9pX/thumb",
            mime: "image/webp",
            size_bytes: 1024,
            width: 1,
            height: 1,
            original_filename: null,
            uploaded_at: new Date().toISOString(),
          },
        ],
        total_count: 1,
        total_bytes: 1024,
      }),
    }
    render(<AttachmentsManager />)

    fireEvent.click(screen.getByRole("button", { name: /^Purge…$/ }))
    // Modal mounts using AlertDialog → title becomes visible.
    expect(
      screen.getByText(/Delete all 1 attachments/i),
    ).toBeInTheDocument()
  })
})
