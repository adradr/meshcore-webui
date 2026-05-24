import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { RecordingsList } from "../RecordingsList"
import type { TraceSample, TraceSessionSummary } from "../api"
import type { CsvDownloader } from "../csv"

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}))

import { api } from "@/lib/api"

function makeSession(
  overrides: Partial<TraceSessionSummary> = {},
): TraceSessionSummary {
  return {
    session_id: "11111111-1111-1111-1111-111111111111",
    target_pubkey: "eccafe7d" + "ff".repeat(28),
    first_sample_at: "2026-05-24T15:56:03.091123+00:00",
    last_sample_at: "2026-05-24T15:56:51.008034+00:00",
    samples_total: 4,
    ok_count: 1,
    error_count: 3,
    ...overrides,
  }
}

function makeSample(overrides: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "11111111-1111-1111-1111-111111111111",
    target_pubkey: "eccafe7d" + "ff".repeat(28),
    started_at: "2026-05-24T15:56:00+00:00",
    finished_at: "2026-05-24T15:56:01+00:00",
    status: "ok",
    path_len: 1,
    snr_there: 5,
    snr_back: 6,
    hops: [{ hash: "aa", snr: 5 }],
    error: null,
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("RecordingsList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders nothing when sessions list is empty", () => {
    const { container } = render(<RecordingsList sessions={[]} />, { wrapper })
    expect(container.firstChild).toBeNull()
  })

  it("renders one row per session with sample count, duration, and CSV button", () => {
    render(
      <RecordingsList
        sessions={[makeSession({ samples_total: 4, ok_count: 1, error_count: 3 })]}
      />,
      { wrapper },
    )
    expect(screen.getByText(/4 samples/i)).toBeInTheDocument()
    expect(screen.getByText(/1 ok/)).toBeInTheDocument()
    expect(screen.getByText(/3 fail/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Download recording/i })).toBeInTheDocument()
  })

  it("fetches samples and triggers download with the right filename + CSV body", async () => {
    const samples: TraceSample[] = [
      makeSample({ finished_at: "2026-05-24T15:56:01+00:00", status: "ok" }),
      makeSample({
        finished_at: "2026-05-24T15:56:11+00:00",
        status: "timeout",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "timeout",
      }),
    ]
    vi.mocked(api.get).mockResolvedValueOnce({
      session_id: "11111111-1111-1111-1111-111111111111",
      target_pubkey: "eccafe7d" + "ff".repeat(28),
      count: 2,
      items: samples,
    })

    const downloaded: { filename: string; content: string }[] = []
    const downloader: CsvDownloader = {
      download(filename, content) {
        downloaded.push({ filename, content })
      },
    }

    render(
      <RecordingsList sessions={[makeSession()]} downloader={downloader} />,
      { wrapper },
    )
    fireEvent.click(
      screen.getByRole("button", { name: /Download recording/i }),
    )

    await waitFor(() => expect(downloaded).toHaveLength(1))
    expect(downloaded[0].filename).toBe("trace-eccafe7d-20260524-1556.csv")
    // CSV has a header + 2 rows; the second is a timeout with empty SNR
    // cells (not "null") and a non-empty error column.
    const lines = downloaded[0].content.trimEnd().split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0].startsWith("finished_at,started_at,status,")).toBe(true)
    expect(lines[2]).toContain(",timeout,,,,0,")
  })

  it("disables the button while one download is in flight", async () => {
    let resolveFetch: (v: {
      session_id: string
      target_pubkey: string
      count: number
      items: TraceSample[]
    }) => void = () => {}
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise((res) => {
        resolveFetch = res
      }),
    )
    const downloader: CsvDownloader = { download: vi.fn() }

    render(
      <RecordingsList sessions={[makeSession()]} downloader={downloader} />,
      { wrapper },
    )
    const button = screen.getByRole("button", { name: /Download recording/i })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())

    // Finish the fetch and observe the button re-enabled.
    resolveFetch({
      session_id: "11111111-1111-1111-1111-111111111111",
      target_pubkey: "eccafe7d" + "ff".repeat(28),
      count: 0,
      items: [],
    })
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
