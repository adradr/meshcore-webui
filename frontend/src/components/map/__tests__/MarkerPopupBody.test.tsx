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
})
