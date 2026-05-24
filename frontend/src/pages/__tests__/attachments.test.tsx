import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { AttachmentListOut } from "@/features/attachments/types"

// Mocked TanStack Query hooks — let each test pick the loading / empty /
// populated branch by reassigning `listState` before render.
let listState: {
  data?: AttachmentListOut
  isLoading: boolean
} = { isLoading: true }
const deleteMutate = vi.fn()

vi.mock("@/features/attachments/queries", () => ({
  useAttachments: () => listState,
  useDeleteAttachment: () => ({ mutate: deleteMutate, isPending: false }),
  usePurgeAttachments: () => ({ mutate: vi.fn(), isPending: false }),
}))

// sonner is rendered by the app shell — stub the toast surface here so
// assertions don't need a Toaster mounted.
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import { AttachmentsPage } from "@/pages/attachments"

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

function renderPage() {
  return render(
    <MemoryRouter>
      <AttachmentsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listState = { isLoading: true }
})

describe("AttachmentsPage", () => {
  it("renders the empty state when there are no attachments", () => {
    listState = { isLoading: false, data: makeList() }
    renderPage()
    expect(screen.getByTestId("attachments-empty")).toBeInTheDocument()
  })

  it("renders an attachment tile per item when the hook returns items", () => {
    listState = {
      isLoading: false,
      data: makeList({
        items: [
          {
            slug: "aB3kZ9pX",
            url: "/s/aB3kZ9pX",
            thumb_url: "/i/aB3kZ9pX/thumb",
            mime: "image/webp",
            size_bytes: 2_200_000,
            width: 800,
            height: 600,
            original_filename: "shot.png",
            uploaded_at: new Date().toISOString(),
          },
          {
            slug: "qZ7mN1tY",
            url: "/s/qZ7mN1tY",
            thumb_url: "/i/qZ7mN1tY/thumb",
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
    renderPage()
    expect(screen.getByTestId("attachments-grid")).toBeInTheDocument()
    expect(screen.getByTestId("attachment-card-aB3kZ9pX")).toBeInTheDocument()
    expect(screen.getByTestId("attachment-card-qZ7mN1tY")).toBeInTheDocument()
  })

  it("clicking a tile copies its public URL and fires a sonner toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    listState = {
      isLoading: false,
      data: makeList({
        items: [
          {
            slug: "aB3kZ9pX",
            url: "/s/aB3kZ9pX",
            thumb_url: "/i/aB3kZ9pX/thumb",
            mime: "image/webp",
            size_bytes: 2_200_000,
            width: 800,
            height: 600,
            original_filename: "shot.png",
            uploaded_at: new Date().toISOString(),
          },
        ],
        total_count: 1,
        total_bytes: 2_200_000,
      }),
    }
    renderPage()

    const tile = screen.getByRole("button", {
      name: /Copy URL for shot\.png/i,
    })
    fireEvent.click(tile)

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    // Relative URL becomes absolute via window.location.origin.
    const arg = writeText.mock.calls[0][0] as string
    expect(arg.endsWith("/s/aB3kZ9pX")).toBe(true)
    expect(/^https?:\/\//.test(arg)).toBe(true)

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("URL copied"),
    )
  })
})
