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

  it("renders Profile link for non-self contacts; Message hidden for REP", () => {
    render(
      wrap(
        <MarkerPopupBody contact={contact} selfHasGps={true} isSelf={false} />,
      ),
    )
    expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute(
      "href",
      "/contact/abc123",
    )
    // Repeater contacts don't accept plain DMs — see upstream meshcore-cli
    // (admin-command target, not a DM peer). The Message button must be hidden.
    expect(
      screen.queryByRole("link", { name: /message repeater alpha/i }),
    ).toBeNull()
  })

  it("renders Message link for companion (CLI) contacts", () => {
    const cliContact = {
      ...contact,
      nodeType: "CLI" as const,
      id: "cli1",
      name: "Companion Bob",
    }
    render(
      wrap(
        <MarkerPopupBody
          contact={cliContact}
          selfHasGps={true}
          isSelf={false}
        />,
      ),
    )
    expect(
      screen.getByRole("link", { name: /message companion bob/i }),
    ).toHaveAttribute("href", "/chat/cli1")
  })

  it("hides Message link for ROOM contacts (admin-command target, not DM peer)", () => {
    const roomContact = {
      ...contact,
      nodeType: "ROOM" as const,
      name: "Room Server",
    }
    render(
      wrap(
        <MarkerPopupBody
          contact={roomContact}
          selfHasGps={true}
          isSelf={false}
        />,
      ),
    )
    expect(
      screen.queryByRole("link", { name: /message room server/i }),
    ).toBeNull()
  })

  it("still renders Message link for UNKNOWN nodeType (safe fallback)", () => {
    const unknownContact = {
      ...contact,
      nodeType: "UNKNOWN" as const,
      name: "Mystery Node",
    }
    render(
      wrap(
        <MarkerPopupBody
          contact={unknownContact}
          selfHasGps={true}
          isSelf={false}
        />,
      ),
    )
    expect(
      screen.getByRole("link", { name: /message mystery node/i }),
    ).toBeInTheDocument()
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

  it("disables Trace button when this node's trace is in flight", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={vi.fn()}
          traceInFlightPubkey={repContact.id}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/trace path to/i)).toBeDisabled()
  })

  it("shows spinner instead of Route icon when this node's trace is in flight", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={vi.fn()}
          traceInFlightPubkey={repContact.id}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByLabelText(/trace path to/i)
    // Loader2 has class animate-spin
    expect(btn.querySelector(".animate-spin")).toBeTruthy()
  })

  it("shows Route icon (no spinner) when no trace is in flight", () => {
    const repContact = { ...contact, nodeType: "REP" as const }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={repContact}
          onTraceRequest={vi.fn()}
          traceInFlightPubkey={null}
          isSelf={false}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByLabelText(/trace path to/i)
    expect(btn.querySelector(".animate-spin")).toBeNull()
  })

  it("shows spinner only on the node whose trace is in flight; disables others", () => {
    const tracingId = "aaaa1111"
    const otherId = "bbbb2222"

    // Render the popup for the tracing node:
    const tracingMarker: ContactMarker = {
      id: tracingId,
      name: "A",
      lat: 0,
      lon: 0,
      nodeType: "REP",
    }
    const { unmount } = render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={tracingMarker}
          isSelf={false}
          onTraceRequest={vi.fn()}
          traceInFlightPubkey={tracingId}
        />
      </MemoryRouter>,
    )
    const tracingBtn = screen.getByLabelText(/trace path to a/i)
    expect(tracingBtn).toBeDisabled()
    expect(tracingBtn.querySelector(".animate-spin")).toBeTruthy()
    unmount()

    // Render the popup for an unrelated node while tracing the first:
    const otherMarker: ContactMarker = {
      id: otherId,
      name: "B",
      lat: 0,
      lon: 0,
      nodeType: "REP",
    }
    render(
      <MemoryRouter>
        <MarkerPopupBody
          contact={otherMarker}
          isSelf={false}
          onTraceRequest={vi.fn()}
          traceInFlightPubkey={tracingId}
        />
      </MemoryRouter>,
    )
    const otherBtn = screen.getByLabelText(/trace path to b/i)
    // Other node's button is disabled (greyed) but NOT spinning
    expect(otherBtn).toBeDisabled()
    expect(otherBtn.querySelector(".animate-spin")).toBeNull()
  })
})
