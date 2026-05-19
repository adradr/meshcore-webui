import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { MarkerPopupBody } from "../MarkerPopupBody"
import type { ContactMarker } from "../MarkersLayer"

const contact: ContactMarker = {
  id: "abc123",
  name: "Repeater Alpha",
  lat: 47.4979,
  lon: 19.0402,
  nodeType: "REP",
}

function wrap(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>
}

describe("MarkerPopupBody", () => {
  it("calls onLosRequest with the contact when the LoS button is clicked", () => {
    const onLos = vi.fn()
    render(
      wrap(
        <MarkerPopupBody
          contact={contact}
          onLosRequest={onLos}
          selfHasGps={true}
          isSelf={false}
        />,
      ),
    )

    const btn = screen.getByLabelText(/compute line of sight to repeater alpha/i)
    fireEvent.click(btn)
    expect(onLos).toHaveBeenCalledTimes(1)
    expect(onLos).toHaveBeenCalledWith(contact)
  })

  it("renders the LoS button as disabled when selfHasGps is false", () => {
    const onLos = vi.fn()
    render(
      wrap(
        <MarkerPopupBody
          contact={contact}
          onLosRequest={onLos}
          selfHasGps={false}
          isSelf={false}
        />,
      ),
    )

    const btn = screen.getByLabelText(/compute line of sight to repeater alpha/i)
    expect(btn).toBeDisabled()
    expect(btn.getAttribute("title")).toMatch(/self location unknown/i)
    fireEvent.click(btn)
    expect(onLos).not.toHaveBeenCalled()
  })

  it("disables the LoS button when no onLosRequest handler is provided", () => {
    render(
      wrap(
        <MarkerPopupBody contact={contact} selfHasGps={true} isSelf={false} />,
      ),
    )
    expect(
      screen.getByLabelText(/compute line of sight to repeater alpha/i),
    ).toBeDisabled()
  })

  it("renders Profile + Message links for non-self contacts", () => {
    render(
      wrap(
        <MarkerPopupBody contact={contact} selfHasGps={true} isSelf={false} />,
      ),
    )
    expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute(
      "href",
      "/contact/abc123",
    )
    expect(
      screen.getByRole("link", { name: /message repeater alpha/i }),
    ).toHaveAttribute("href", "/chat/abc123")
  })

  it("renders only the Device info action when isSelf=true (no LoS button)", () => {
    render(
      wrap(
        <MarkerPopupBody
          contact={{ ...contact, id: "__self__", name: "Me" }}
          selfHasGps={true}
          isSelf={true}
        />,
      ),
    )
    expect(screen.getByRole("link", { name: /device info/i })).toHaveAttribute(
      "href",
      "/device",
    )
    expect(screen.queryByLabelText(/compute line of sight/i)).toBeNull()
    expect(screen.queryByRole("link", { name: /profile/i })).toBeNull()
  })

  it("renders Trace button only for REP nodes", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    const cliContact = { ...contact, nodeType: "CLI" as const, id: "cli1" }
    const onTrace = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={onTrace}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/trace path to/i)).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <MarkerPopupBody
          contact={cliContact}
          onTraceRequest={onTrace}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByLabelText(/trace path to/i)).toBeNull()
  })

  it("renders Trace button for ROOM nodes", () => {
    const roomContact = { ...contact, nodeType: "ROOM" as const }
    render(
      wrap(
        <MarkerPopupBody
          contact={roomContact}
          onTraceRequest={vi.fn()}
          isSelf={false}
        />,
      ),
    )
    expect(screen.getByLabelText(/trace path to/i)).toBeInTheDocument()
  })

  it("does not render Trace button for UNKNOWN nodes", () => {
    const unknownContact = { ...contact, nodeType: "UNKNOWN" as const }
    render(
      wrap(
        <MarkerPopupBody
          contact={unknownContact}
          onTraceRequest={vi.fn()}
          isSelf={false}
        />,
      ),
    )
    expect(screen.queryByLabelText(/trace path to/i)).toBeNull()
  })

  it("calls onTraceRequest with the contact when Trace clicked", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    const onTrace = vi.fn()
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={onTrace}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByLabelText(/trace path to/i))
    expect(onTrace).toHaveBeenCalledWith(repContact)
  })

  it("disables Trace button when traceInFlight=true", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={vi.fn()}
          traceInFlight={true}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/trace path to/i)).toBeDisabled()
  })

  it("shows spinner instead of Route icon when traceInFlight=true", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={vi.fn()}
          traceInFlight={true}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByLabelText(/trace path to/i)
    // Loader2 has class animate-spin
    expect(btn.querySelector(".animate-spin")).toBeTruthy()
  })

  it("shows Route icon (no spinner) when traceInFlight=false", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={vi.fn()}
          traceInFlight={false}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByLabelText(/trace path to/i)
    expect(btn.querySelector(".animate-spin")).toBeNull()
  })
})
