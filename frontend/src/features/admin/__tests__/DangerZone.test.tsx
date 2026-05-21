import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const localMutate = vi.fn()
const softMutate = vi.fn()
const factoryMutate = vi.fn()

vi.mock("../api", () => ({
  useLocalReset: () => ({ mutate: localMutate, isPending: false }),
  useDeviceSoftReset: () => ({ mutate: softMutate, isPending: false }),
  useDeviceFactoryReset: () => ({ mutate: factoryMutate, isPending: false }),
}))

import { DangerZone } from "../DangerZone"

beforeEach(() => {
  vi.clearAllMocks()
})

/** Click the trigger button that opens an AlertDialog. The DangerZone has
 *  several "Reset…" buttons — qualify by exact-match name so we hit the
 *  right one. */
function openDialog(triggerName: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }))
}

describe("DangerZone", () => {
  it("clear chat history → click confirms with 'Clear chat history'", () => {
    render(<DangerZone />)
    openDialog(/^Clear…$/)
    const action = screen.getByRole("button", {
      name: /^Clear chat history$/,
    })
    fireEvent.click(action)
    expect(localMutate).toHaveBeenCalledWith({
      scope: "messages",
      confirm: "Clear chat history",
    })
  })

  it("reset all → action disabled until 'RESET' typed, then confirms", () => {
    render(<DangerZone />)
    // The "Reset all local data" row has trigger "Reset…" — there are several
    // "Reset…" buttons, so walk up to the flex-row that contains the button.
    const label = screen.getByText(/^Reset all local data$/)
    const allRow = label.closest(".flex.items-center") as HTMLElement
    fireEvent.click(within(allRow).getByRole("button", { name: /^Reset…$/ }))

    const action = screen.getByRole("button", { name: /^Reset$/ })
    expect(action).toBeDisabled()

    const input = screen.getByLabelText(/Confirm by typing RESET/)
    fireEvent.change(input, { target: { value: "RESET" } })
    expect(action).not.toBeDisabled()
    fireEvent.click(action)
    expect(localMutate).toHaveBeenCalledWith({
      scope: "all",
      confirm: "RESET",
    })
  })

  it("reset push subscribers → click confirms with 'Reset push subscribers'", () => {
    render(<DangerZone />)
    // The row-level label here is the <div className="text-sm font-medium">.
    // The card title also says "Reset push subscribers", so getAllByText and pick
    // the row label (the one inside the flex row), not the dialog title.
    const labels = screen.getAllByText(/^Reset push subscribers$/)
    const rowLabel = labels.find(
      (el) => el.className.includes("text-sm") && el.className.includes("font-medium"),
    ) as HTMLElement
    const pushRow = rowLabel.closest(".flex.items-center") as HTMLElement
    fireEvent.click(within(pushRow).getByRole("button", { name: /^Reset…$/ }))

    const action = screen.getByRole("button", {
      name: /^Reset push subscribers$/,
    })
    fireEvent.click(action)
    expect(localMutate).toHaveBeenCalledWith({
      scope: "push",
      confirm: "Reset push subscribers",
    })
  })

  it("soft reset → type 'RESET' → device soft reset called", () => {
    render(<DangerZone />)
    openDialog(/^Reset device…$/)

    const action = screen.getByRole("button", { name: /^Soft reset$/ })
    expect(action).toBeDisabled()

    const input = screen.getByLabelText(/Confirm by typing RESET/)
    fireEvent.change(input, { target: { value: "RESET" } })
    expect(action).not.toBeDisabled()
    fireEvent.click(action)
    expect(softMutate).toHaveBeenCalledWith({ confirm: "RESET" })
  })

  it("factory reset → BOTH typed string AND checkbox required", () => {
    render(<DangerZone />)
    openDialog(/^Factory reset…$/)

    const action = screen.getByRole("button", { name: /^Factory reset$/ })
    expect(action).toBeDisabled()

    const input = screen.getByLabelText(/Confirm by typing FACTORY RESET/)
    const checkbox = screen.getByLabelText(
      /I understand my pubkey will change/,
    ) as HTMLInputElement

    // Only typed → still disabled
    fireEvent.change(input, { target: { value: "FACTORY RESET" } })
    expect(action).toBeDisabled()

    // Only checkbox (clear input first) → still disabled
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(action).toBeDisabled()

    // Both → enabled
    fireEvent.change(input, { target: { value: "FACTORY RESET" } })
    expect(action).not.toBeDisabled()
    fireEvent.click(action)
    expect(factoryMutate).toHaveBeenCalledWith({ confirm: "FACTORY RESET" })
  })
})
