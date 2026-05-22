import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

// react-leaflet pulls in DOM APIs jsdom doesn't fully support — stub the
// primitives so the component can mount. We only care about the props
// passed down to MarkerClusterGroup here.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="leaflet-map">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Popup: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useMap: () => ({
    panTo: () => {},
    setView: () => {},
    fitBounds: () => {},
    getCenter: () => ({ lat: 0, lng: 0 }),
    getZoom: () => 1,
    on: () => {},
    off: () => {},
    invalidateSize: () => {},
  }),
  useMapEvents: () => ({}),
}))

// Capture props passed to MarkerClusterGroup so we can assert on the
// clustering configuration without running real Leaflet code.
const clusterCalls: Record<string, unknown>[] = []
vi.mock("react-leaflet-cluster", () => {
  const MarkerClusterGroup = (props: Record<string, unknown>) => {
    clusterCalls.push(props)
    return <>{props.children as React.ReactNode}</>
  }
  return { default: MarkerClusterGroup }
})

// Children rendered by MarkersLayer rely on Leaflet context — stub them
// out since this test only cares about cluster props.
vi.mock("../MarkersLayer", () => ({
  MarkersLayer: () => null,
}))
vi.mock("../MapViewPersistence", () => ({
  MapViewPersistence: () => null,
}))
vi.mock("../CenterOnContactsButton", () => ({
  CenterOnContactsButton: () => null,
}))
vi.mock("../TileLayers", () => ({
  ThemedTileLayer: () => null,
}))
vi.mock("../useMapResize", () => ({
  MapResizer: () => null,
}))
vi.mock("@/lib/leaflet/fixDefaultIcon", () => ({
  fixDefaultIcon: () => {},
}))
vi.mock("../nodeIcons", () => ({
  iconForNodeType: () => undefined,
}))

import { ClusteredContactMap } from "../ClusteredContactMap"

describe("ClusteredContactMap clustering config", () => {
  it("passes loosened clustering props to MarkerClusterGroup", () => {
    clusterCalls.length = 0
    render(<ClusteredContactMap contacts={[]} />)
    expect(clusterCalls.length).toBeGreaterThan(0)
    const props = clusterCalls[0]!
    expect(props.maxClusterRadius).toBe(40)
    expect(props.disableClusteringAtZoom).toBe(14)
    expect(props.spiderfyOnMaxZoom).toBe(true)
    expect(props.showCoverageOnHover).toBe(false)
    expect(props.chunkedLoading).toBe(true)
  })
})
