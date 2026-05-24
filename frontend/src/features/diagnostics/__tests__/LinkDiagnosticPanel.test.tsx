import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("../api", () => ({
  useLastDiagnostic: vi.fn(),
  useLinkDiagnostic: vi.fn(),
}))

import { useLastDiagnostic, useLinkDiagnostic } from "../api"
import { LinkDiagnosticPanel, verdictTier } from "../LinkDiagnosticPanel"
import type { DiagnosticReport, StepResult } from "../types"

const PUBKEY = "ab".repeat(32)

function makeStep(overrides: Partial<StepResult> = {}): StepResult {
  const now = new Date().toISOString()
  return {
    step: "ping",
    status: "responded",
    started_at: now,
    finished_at: now,
    data: {},
    error: null,
    skip_reason: null,
    attempts: 1,
    successes: 1,
    ...overrides,
  }
}

function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  const now = new Date().toISOString()
  return {
    target_pubkey: PUBKEY,
    target_name: "Node A",
    contact_type: 1,
    started_at: now,
    finished_at: now,
    steps: [],
    verdict: "healthy",
    verdict_detail: "All checks passed.",
    ...overrides,
  }
}

function setQuery(data: DiagnosticReport | undefined, isLoading = false) {
  ;(useLastDiagnostic as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data,
    isLoading,
  })
}

function setMutation(opts: {
  mutate?: ReturnType<typeof vi.fn>
  isPending?: boolean
  data?: DiagnosticReport | undefined
}) {
  ;(useLinkDiagnostic as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: opts.mutate ?? vi.fn(),
    isPending: opts.isPending ?? false,
    data: opts.data,
  })
}

describe("LinkDiagnosticPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the empty state when no diagnostic exists", () => {
    setQuery(undefined, false)
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(
      screen.getByText(/No diagnostic recorded for this contact yet/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /run link diagnostic/i }),
    ).toHaveTextContent(/^Run$/)
  })

  it("shows a loading hint while the last-run query is pending", () => {
    setQuery(undefined, true)
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(screen.getByText(/Checking for previous runs/i)).toBeInTheDocument()
  })

  it("renders the persisted report when present", () => {
    setQuery(
      makeReport({
        steps: [
          makeStep({ step: "local_stats_radio", status: "responded" }),
          makeStep({ step: "local_stats_core", status: "responded" }),
          makeStep({ step: "local_stats_packets", status: "responded" }),
        ],
        verdict: "healthy",
        verdict_detail: "All checks passed.",
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(screen.getByText("Local radio stats")).toBeInTheDocument()
    expect(screen.getByText("Local core stats")).toBeInTheDocument()
    expect(screen.getByText("Local packet counters")).toBeInTheDocument()
    expect(screen.getByText(/healthy/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /run link diagnostic/i }),
    ).toHaveTextContent(/Re-run/)
  })

  it("renders no_response steps with their error message", () => {
    setQuery(
      makeReport({
        steps: [
          makeStep({
            step: "ping",
            status: "no_response",
            error: "MeshCore not connected",
          }),
        ],
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(screen.getByText("MeshCore not connected")).toBeInTheDocument()
  })

  it("renders skipped steps with their skip_reason", () => {
    setQuery(
      makeReport({
        steps: [
          makeStep({
            step: "remote_neighbours",
            status: "skipped",
            skip_reason: "Companion contact — neighbour list not applicable",
          }),
        ],
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(
      screen.getByText(/Companion contact — neighbour list not applicable/i),
    ).toBeInTheDocument()
  })

  it("clicking Run triggers the mutation", () => {
    setQuery(undefined, false)
    const mutate = vi.fn()
    setMutation({ mutate, isPending: false })
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    fireEvent.click(
      screen.getByRole("button", { name: /run link diagnostic/i }),
    )
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({})
  })

  it("Run button disabled and shows Running… while mutation is pending", () => {
    setQuery(undefined, false)
    setMutation({ mutate: vi.fn(), isPending: true })
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    const button = screen.getByRole("button", { name: /run link diagnostic/i })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent(/Running/)
  })

  it("renders the header description explaining the diagnostic", () => {
    setQuery(undefined, false)
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(
      screen.getByText(/Runs an end-to-end RF probe between your radio and this contact/i),
    ).toBeInTheDocument()
  })

  it("HEALTHY tier card renders when all steps responded", () => {
    setQuery(
      makeReport({
        steps: [
          makeStep({ step: "ping", status: "responded" }),
          makeStep({ step: "telemetry", status: "responded" }),
        ],
        verdict: "healthy",
        verdict_detail: "All checks passed.",
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    const card = screen.getByTestId("verdict-card")
    expect(card).toHaveAttribute("data-tier", "HEALTHY")
    expect(card).toHaveTextContent("HEALTHY")
    expect(card).toHaveTextContent(/2 of 2 steps responded/)
  })

  it("DEGRADED tier card renders when some steps failed", () => {
    setQuery(
      makeReport({
        verdict: "partial",
        verdict_detail: "Ping ok, telemetry quiet.",
        steps: [
          makeStep({ step: "ping", status: "responded" }),
          makeStep({ step: "telemetry", status: "no_response", error: "timeout" }),
        ],
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    const card = screen.getByTestId("verdict-card")
    expect(card).toHaveAttribute("data-tier", "DEGRADED")
    expect(card).toHaveTextContent("DEGRADED")
  })

  it("UNREACHABLE tier card renders when all attempted steps failed", () => {
    setQuery(
      makeReport({
        verdict: "unreachable",
        verdict_detail: "No response at all.",
        steps: [
          makeStep({ step: "ping", status: "no_response", error: "timeout" }),
          makeStep({
            step: "telemetry",
            status: "no_response",
            error: "no reply",
          }),
        ],
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    const card = screen.getByTestId("verdict-card")
    expect(card).toHaveAttribute("data-tier", "UNREACHABLE")
    expect(card).toHaveTextContent("UNREACHABLE")
  })

  it("renders status chips per step with plain-English labels", () => {
    setQuery(
      makeReport({
        steps: [
          makeStep({ step: "ping", status: "responded" }),
          makeStep({ step: "telemetry", status: "no_response", error: "timeout" }),
          makeStep({
            step: "remote_neighbours",
            status: "skipped",
            skip_reason: "Companion contact",
          }),
        ],
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(screen.getByText("responded")).toBeInTheDocument()
    expect(screen.getByText("no response")).toBeInTheDocument()
    expect(screen.getByText("skipped")).toBeInTheDocument()
  })

  it("renders the per-step plain-English description", () => {
    setQuery(
      makeReport({
        steps: [makeStep({ step: "ping", status: "responded" })],
      }),
    )
    setMutation({})
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(
      screen.getByText(/Round-trip echo: did this contact respond at all/i),
    ).toBeInTheDocument()
  })

  describe("verdictTier()", () => {
    function reportOf(
      verdict: string,
      stepStatuses: StepResult["status"][],
    ): DiagnosticReport {
      const now = new Date().toISOString()
      return {
        target_pubkey: PUBKEY,
        target_name: null,
        contact_type: null,
        started_at: now,
        finished_at: now,
        verdict,
        verdict_detail: "",
        steps: stepStatuses.map((status, i) => makeStep({ step: `s${i}`, status })),
      }
    }

    it("HEALTHY when verdict is 'healthy'", () => {
      expect(verdictTier(reportOf("healthy", ["responded", "responded"]))).toBe("HEALTHY")
    })

    it("DEGRADED when responded + no_response mix", () => {
      expect(verdictTier(reportOf("partial", ["responded", "no_response"]))).toBe("DEGRADED")
    })

    it("UNREACHABLE when every attempted step is no_response", () => {
      expect(verdictTier(reportOf("dead", ["no_response", "no_response"]))).toBe("UNREACHABLE")
    })

    it("DEGRADED as fallback for skipped/not_attempted only", () => {
      expect(verdictTier(reportOf("inconclusive", ["skipped", "not_attempted"]))).toBe(
        "DEGRADED",
      )
    })
  })

  it("mutation result takes precedence over the last-run cache", () => {
    setQuery(
      makeReport({
        verdict: "inconclusive",
        verdict_detail: "Stale data — last run could not finish.",
      }),
    )
    setMutation({
      mutate: vi.fn(),
      isPending: false,
      data: makeReport({
        verdict: "healthy",
        verdict_detail: "Fresh run is clean.",
      }),
    })
    render(<LinkDiagnosticPanel pubkey={PUBKEY} />)
    expect(screen.getByText(/healthy/i)).toBeInTheDocument()
    expect(screen.getByText("Fresh run is clean.")).toBeInTheDocument()
    expect(screen.queryByText(/inconclusive/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText("Stale data — last run could not finish."),
    ).not.toBeInTheDocument()
  })
})
