import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock the hooks module (Task 6) so the panel renders against scripted state.
// Mirrors the LinkDiagnosticPanel test pattern.
// ---------------------------------------------------------------------------
vi.mock("../api", () => ({
  useTraceMonitorStatus: vi.fn(),
  useStartTraceMonitor: vi.fn(),
  useStopTraceMonitor: vi.fn(),
  useTraceMonitorSamples: vi.fn(),
  useTraceMonitorSessions: vi.fn(),
  useDeleteTraceMonitorSession: vi.fn(),
}))

// Mock the chart so we can inspect prop wiring without uPlot pixel rendering.
const lastChartProps: { samples: unknown; showPerHop: unknown } = {
  samples: null,
  showPerHop: null,
}
vi.mock("../TraceMonitorChart", () => ({
  TraceMonitorChart: (props: { samples: unknown; showPerHop?: boolean }) => {
    lastChartProps.samples = props.samples
    lastChartProps.showPerHop = props.showPerHop ?? false
    return <div data-testid="trace-monitor-chart" />
  },
}))

import {
  useTraceMonitorStatus,
  useStartTraceMonitor,
  useStopTraceMonitor,
  useTraceMonitorSamples,
  useTraceMonitorSessions,
  useDeleteTraceMonitorSession,
  type TraceSample,
  type TraceStatus,
  type TraceSessionSummary,
} from "../api"
import { TraceMonitorPanel } from "../TraceMonitorPanel"

const PUBKEY = "ab".repeat(32)
const OTHER_PUBKEY = "cd".repeat(32)

function makeStatus(overrides: Partial<TraceStatus> = {}): TraceStatus {
  return {
    running: false,
    session_id: null,
    target_pubkey: null,
    interval_s: null,
    started_at: null,
    samples_total: null,
    last_sample_at: null,
    ...overrides,
  }
}

function makeSample(overrides: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "11111111-1111-1111-1111-111111111111",
    target_pubkey: PUBKEY,
    started_at: "2026-05-23T10:00:00Z",
    finished_at: "2026-05-23T10:00:01Z",
    status: "ok",
    path_len: 3,
    snr_there: -4,
    snr_back: -8,
    hops: [
      { hash: "aa", snr: -3 },
      { hash: "bb", snr: -5 },
      { hash: "cc", snr: -7 },
    ],
    error: null,
    ...overrides,
  }
}

function makeSession(
  overrides: Partial<TraceSessionSummary> = {},
): TraceSessionSummary {
  return {
    session_id: "22222222-2222-2222-2222-222222222222",
    target_pubkey: PUBKEY,
    first_sample_at: "2026-05-23T09:00:00Z",
    last_sample_at: "2026-05-23T09:15:00Z",
    samples_total: 30,
    ok_count: 28,
    error_count: 2,
    ...overrides,
  }
}

// Stable references so panel hooks don't keep churning across renders.
const noopMutate = vi.fn()

interface SetupOpts {
  status?: TraceStatus
  samples?: TraceSample[]
  sessions?: TraceSessionSummary[]
  startMutate?: ReturnType<typeof vi.fn>
  stopMutate?: ReturnType<typeof vi.fn>
  deleteMutate?: ReturnType<typeof vi.fn>
  startPending?: boolean
  stopPending?: boolean
}

function setup(opts: SetupOpts = {}) {
  ;(useTraceMonitorStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    { data: opts.status ?? makeStatus(), isLoading: false },
  )
  ;(useTraceMonitorSamples as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    { data: opts.samples ?? [], isLoading: false },
  )
  ;(useTraceMonitorSessions as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    { data: { count: opts.sessions?.length ?? 0, items: opts.sessions ?? [] } },
  )
  ;(useStartTraceMonitor as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    {
      mutate: opts.startMutate ?? noopMutate,
      isPending: opts.startPending ?? false,
    },
  )
  ;(useStopTraceMonitor as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: opts.stopMutate ?? noopMutate,
    isPending: opts.stopPending ?? false,
  })
  ;(useDeleteTraceMonitorSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    {
      mutate: opts.deleteMutate ?? noopMutate,
      mutateAsync: vi.fn().mockResolvedValue({ deleted: 1 }),
      isPending: false,
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  lastChartProps.samples = null
  lastChartProps.showPerHop = null
})

describe("TraceMonitorPanel", () => {
  it("idle + no history: shows Start, no Stop, no Wipe history", () => {
    setup()
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    expect(
      screen.getByRole("button", { name: /^start$/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /wipe history/i })).toBeNull()
  })

  it("idle + with history: shows Start + Wipe history and 'Showing last session' badge", () => {
    setup({
      sessions: [
        makeSession({ session_id: "22222222-2222-2222-2222-222222222222" }),
      ],
      samples: [makeSample()],
    })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    expect(
      screen.getByRole("button", { name: /^start$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /wipe history/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/showing last session/i)).toBeInTheDocument()
    expect(screen.getByTestId("trace-monitor-chart")).toBeInTheDocument()
    // The hook should have been called with the most-recent session id.
    expect(useTraceMonitorSamples).toHaveBeenCalledWith(
      "22222222-2222-2222-2222-222222222222",
    )
  })

  it("running for THIS pubkey: shows Stop, Take over not visible, summary populated", () => {
    const sampleTime = new Date(Date.now() - 4200).toISOString()
    setup({
      status: makeStatus({
        running: true,
        session_id: "33333333-3333-3333-3333-333333333333",
        target_pubkey: PUBKEY,
        interval_s: 10,
        started_at: "2026-05-23T14:02:00Z",
        samples_total: 13,
        last_sample_at: sampleTime,
      }),
      samples: [makeSample({ finished_at: sampleTime })],
    })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /take over/i })).toBeNull()
    expect(screen.getByText(/SNR there/i)).toBeInTheDocument()
    expect(screen.getByText(/3 hops/i)).toBeInTheDocument()
  })

  it("running for DIFFERENT pubkey: shows Take over button", () => {
    setup({
      status: makeStatus({
        running: true,
        session_id: "44444444-4444-4444-4444-444444444444",
        target_pubkey: OTHER_PUBKEY,
        interval_s: 10,
        started_at: "2026-05-23T14:02:00Z",
      }),
    })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    expect(
      screen.getByRole("button", { name: /take over/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^start$/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull()
  })

  it("clicking Start sends POST /start with current slider value (default 10s)", () => {
    const startMutate = vi.fn()
    setup({ startMutate })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }))
    expect(startMutate).toHaveBeenCalledTimes(1)
    expect(startMutate).toHaveBeenCalledWith({
      pubkey: PUBKEY,
      interval_s: 10,
    })
  })

  it("clicking Take over → confirm dialog → action sends force: true", async () => {
    const startMutate = vi.fn()
    setup({
      status: makeStatus({
        running: true,
        session_id: "44444444-4444-4444-4444-444444444444",
        target_pubkey: OTHER_PUBKEY,
        interval_s: 15,
        started_at: "2026-05-23T14:02:00Z",
      }),
      startMutate,
    })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    fireEvent.click(screen.getByRole("button", { name: /take over/i }))
    // AlertDialog action button is rendered into a portal — same DOM root,
    // but appears after the trigger click.
    const confirm = await screen.findByRole("button", {
      name: /confirm take over/i,
    })
    fireEvent.click(confirm)
    expect(startMutate).toHaveBeenCalledTimes(1)
    expect(startMutate).toHaveBeenCalledWith({
      pubkey: PUBKEY,
      interval_s: 10,
      force: true,
    })
  })

  it("interval slider is disabled while monitor is running", () => {
    setup({
      status: makeStatus({
        running: true,
        session_id: "55555555-5555-5555-5555-555555555555",
        target_pubkey: PUBKEY,
        interval_s: 10,
        started_at: "2026-05-23T14:02:00Z",
      }),
    })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    // Radix Slider thumb (`role="slider"`) exposes the disabled state via
    // a `data-disabled` attribute rather than `aria-disabled`.
    const slider = screen.getByRole("slider")
    expect(slider.hasAttribute("data-disabled")).toBe(true)
  })

  it("toggling 'Show per-hop SNR' propagates showPerHop=true to the chart", () => {
    setup({
      sessions: [makeSession()],
      samples: [makeSample()],
    })
    render(<TraceMonitorPanel pubkey={PUBKEY} />)
    expect(lastChartProps.showPerHop).toBe(false)
    const toggle = screen.getByRole("switch", { name: /show per-hop snr/i })
    fireEvent.click(toggle)
    expect(lastChartProps.showPerHop).toBe(true)
  })

  it("last-sample summary 'ago' text recomputes over time", () => {
    vi.useFakeTimers()
    try {
      const sampleTime = new Date(Date.now() - 1500).toISOString()
      setup({
        status: makeStatus({
          running: true,
          session_id: "66666666-6666-6666-6666-666666666666",
          target_pubkey: PUBKEY,
          interval_s: 10,
          started_at: "2026-05-23T14:02:00Z",
          samples_total: 1,
          last_sample_at: sampleTime,
        }),
        samples: [makeSample({ finished_at: sampleTime })],
      })
      render(<TraceMonitorPanel pubkey={PUBKEY} />)
      // Initial render: ~1.5s ago.
      expect(screen.getByText(/1\.[0-9] s ago/)).toBeInTheDocument()
      // Advance 3s — the ticker should re-render with a larger number.
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      expect(screen.getByText(/[34]\.[0-9] s ago/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

afterEach(() => {
  // Defence-in-depth — ensure no fake timer state escapes a failing test.
  vi.useRealTimers()
})
