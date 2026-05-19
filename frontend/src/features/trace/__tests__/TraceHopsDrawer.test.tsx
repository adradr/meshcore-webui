import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TraceHopsDrawer } from "../TraceHopsDrawer"
import type { TraceOut } from "../api"

const sampleTrace: TraceOut = {
  requested_target_pubkey: "ab".repeat(32),
  tag: 4242,
  flags: 0,
  path_len: 2,
  hops: [
    {
      hash: "ab",
      snr: 3.5,
      name: "Alpha",
      pub_key: "abc".padEnd(64, "0"),
      lat: 1.0,
      lon: 2.0,
      candidates: [],
    },
    {
      hash: "cd",
      snr: 4.0,
      name: null,
      pub_key: null,
      lat: null,
      lon: null,
      candidates: [],
    },
    {
      hash: "ef",
      snr: 5.5,
      name: null,
      pub_key: null,
      lat: null,
      lon: null,
      candidates: [
        { name: "Maybe1", pub_key: "ef00".padEnd(64, "0"), lat: 0, lon: 0 },
        { name: "Maybe2", pub_key: "ef11".padEnd(64, "0"), lat: 0, lon: 0 },
      ],
    },
  ],
}

describe("TraceHopsDrawer", () => {
  it("renders nothing when trace is null", () => {
    render(
      <TraceHopsDrawer open={true} onOpenChange={() => {}} trace={null} />,
    )
    expect(screen.queryByText(/trace hops/i)).toBeNull()
  })

  it("renders header with hop count + tag", () => {
    render(
      <TraceHopsDrawer
        open={true}
        onOpenChange={() => {}}
        trace={sampleTrace}
      />,
    )
    expect(screen.getByText(/3 hop/i)).toBeInTheDocument()
    expect(screen.getByText(/4242/)).toBeInTheDocument()
  })

  it("lists each hop with name or hash + snr", () => {
    render(
      <TraceHopsDrawer
        open={true}
        onOpenChange={() => {}}
        trace={sampleTrace}
      />,
    )
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/hash: cd/)).toBeInTheDocument()
    expect(screen.getByText(/3\.5 dB/i)).toBeInTheDocument()
    expect(screen.getByText(/4\.0 dB/i)).toBeInTheDocument()
  })

  it("shows 'ambiguous' badge for hop with multiple candidates", () => {
    render(
      <TraceHopsDrawer
        open={true}
        onOpenChange={() => {}}
        trace={sampleTrace}
      />,
    )
    expect(screen.getByText(/2 candidates/i)).toBeInTheDocument()
  })

  it("invokes onOpenChange(false) when close clicked", () => {
    const cb = vi.fn()
    render(
      <TraceHopsDrawer open={true} onOpenChange={cb} trace={sampleTrace} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /close/i }))
    expect(cb).toHaveBeenCalledWith(false)
  })
})
