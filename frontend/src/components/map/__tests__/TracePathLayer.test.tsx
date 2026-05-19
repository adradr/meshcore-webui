import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { MapContainer } from "react-leaflet"
import { TracePathLayer } from "../TracePathLayer"
import type { TraceHopOut } from "@/features/trace/api"

function wrap(ui: React.ReactNode) {
  return (
    <MapContainer center={[0, 0]} zoom={5} style={{ height: 400, width: 400 }}>
      {ui}
    </MapContainer>
  )
}

const plottedHop: TraceHopOut = {
  hash: "ab",
  snr: 3.5,
  name: "A",
  pub_key: "ab" + "00".repeat(31),
  lat: 0,
  lon: 0,
  candidates: [],
}

const orphanHop: TraceHopOut = {
  hash: "cd",
  snr: 4.0,
  name: null,
  pub_key: null,
  lat: null,
  lon: null,
  candidates: [],
}

describe("TracePathLayer", () => {
  it("reports unplotted hops via callback when all hops lack GPS", () => {
    const cb = vi.fn()
    render(wrap(<TracePathLayer hops={[orphanHop]} onUnplottedHops={cb} />))
    expect(cb).toHaveBeenCalledWith([orphanHop])
  })

  it("renders without crashing with mixed plotted + unplotted", () => {
    const cb = vi.fn()
    const { container } = render(
      wrap(
        <TracePathLayer
          hops={[plottedHop, orphanHop]}
          onUnplottedHops={cb}
          origin={{ lat: 0, lon: 0, name: "self" }}
        />,
      ),
    )
    expect(container).toBeTruthy()
    expect(cb).toHaveBeenCalledWith([orphanHop])
  })

  it("renders without crashing with only plotted hops", () => {
    const { container } = render(
      wrap(
        <TracePathLayer
          hops={[plottedHop, { ...plottedHop, hash: "ef", lat: 1, lon: 1 }]}
        />,
      ),
    )
    expect(container).toBeTruthy()
  })

  it("reports empty array when all hops are plotted", () => {
    const cb = vi.fn()
    render(
      wrap(
        <TracePathLayer
          hops={[plottedHop, { ...plottedHop, hash: "ef", lat: 1, lon: 1 }]}
          onUnplottedHops={cb}
        />,
      ),
    )
    expect(cb).toHaveBeenCalledWith([])
  })
})
