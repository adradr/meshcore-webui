import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

const emittedPolylines: unknown[] = []
const emittedMarkers: unknown[] = []
vi.mock("react-leaflet", () => ({
  Polyline: (p: unknown) => {
    emittedPolylines.push(p)
    return null
  },
  CircleMarker: (p: { children?: unknown }) => {
    emittedMarkers.push(p)
    return null
  },
  Tooltip: () => null,
}))

import { TraceMonitorMapLayer } from "../TraceMonitorMapLayer"
import type { TraceSample } from "@/features/trace/monitor/api"
import type { Contact } from "@/features/contacts/queries"

const baseContacts = {
  ["aa" + "0".repeat(62)]: {
    public_key: "aa" + "0".repeat(62),
    adv_name: "REP-A",
    adv_lat: 47.5,
    adv_lon: 19.0,
    type: 2, // REPEATER
  } as Contact,
  ["bb" + "0".repeat(62)]: {
    public_key: "bb" + "0".repeat(62),
    adv_name: "REP-B",
    adv_lat: 47.6,
    adv_lon: 19.1,
    type: 2, // REPEATER
  } as Contact,
}

function ok(hops: { hash: string; snr: number }[]): TraceSample {
  return {
    session_id: "s",
    target_pubkey: "cc" + "0".repeat(62),
    started_at: "2026-05-24T15:00:00+00:00",
    finished_at: "2026-05-24T15:00:01+00:00",
    status: "ok",
    path_len: hops.length,
    snr_there: 5,
    snr_back: 6,
    hops,
    error: null,
  }
}

describe("TraceMonitorMapLayer", () => {
  beforeEach(() => {
    emittedPolylines.length = 0
    emittedMarkers.length = 0
  })

  it("renders one polyline for the most recent ok sample", () => {
    render(
      <TraceMonitorMapLayer
        samples={[ok([{ hash: "aa", snr: 1 }, { hash: "bb", snr: 2 }])]}
        contacts={baseContacts}
        self={{ lat: 47.4, lon: 18.9 }}
      />,
    )
    expect(emittedPolylines.length).toBeGreaterThan(0)
  })

  it("renders one CircleMarker per distinct resolved hop hash", () => {
    render(
      <TraceMonitorMapLayer
        samples={[
          ok([{ hash: "aa", snr: 1 }, { hash: "bb", snr: 2 }]),
          ok([{ hash: "aa", snr: 3 }, { hash: "bb", snr: 4 }]),
        ]}
        contacts={baseContacts}
        self={{ lat: 47.4, lon: 18.9 }}
      />,
    )
    expect(emittedMarkers.length).toBe(2)
  })

  it("treats hashes as case-insensitive (firmware can emit either case)", () => {
    render(
      <TraceMonitorMapLayer
        samples={[
          ok([{ hash: "AA", snr: 1 }, { hash: "BB", snr: 2 }]),
          ok([{ hash: "aa", snr: 3 }, { hash: "bb", snr: 4 }]),
        ]}
        contacts={baseContacts}
        self={{ lat: 47.4, lon: 18.9 }}
      />,
    )
    // 2 distinct PHYSICAL hops despite mixed case → 2 markers, not 4.
    expect(emittedMarkers.length).toBe(2)
  })

  it("emits nothing when no ok samples are present", () => {
    render(
      <TraceMonitorMapLayer samples={[]} contacts={baseContacts} self={null} />,
    )
    expect(emittedPolylines.length).toBe(0)
    expect(emittedMarkers.length).toBe(0)
  })
})
