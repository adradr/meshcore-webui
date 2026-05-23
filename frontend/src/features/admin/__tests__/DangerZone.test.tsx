import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const resetMutate = vi.fn()
const factoryMutate = vi.fn()

vi.mock("../api", () => ({
  useReset: () => ({ mutate: resetMutate, isPending: false }),
  useDeviceFactoryReset: () => ({ mutate: factoryMutate, isPending: false }),
}))

import { DangerZone } from "../DangerZone"

beforeEach(() => {
  vi.clearAllMocks()
})

/** Click the main "Reset…" trigger (the unified dialog one, not factory). */
function openResetDialog() {
  // There's only one "Reset…" button — factory's says "Factory reset…".
  fireEvent.click(screen.getByRole("button", { name: /^Reset…$/ }))
}

function openFactoryDialog() {
  fireEvent.click(screen.getByRole("button", { name: /^Factory reset…$/ }))
}

describe("DangerZone — unified reset dialog", () => {
  it("clicking 'Reset…' opens the unified dialog with all checkboxes unchecked and the action disabled (0 selected)", () => {
    render(<DangerZone />)
    openResetDialog()

    // 7 local + 3 device checkboxes, all unchecked.
    const localKeys = [
      "messages",
      "diagnostic_runs",
      "rx_log",
      "mutes",
      "settings",
      "push_subscribers",
      "trace_samples",
    ]
    for (const k of localKeys) {
      const cb = screen.getByTestId(`reset-local-${k}`) as HTMLInputElement
      expect(cb.checked).toBe(false)
    }
    const deviceKeys = ["channels", "coords", "contacts"]
    for (const k of deviceKeys) {
      const cb = screen.getByTestId(`reset-device-${k}`) as HTMLInputElement
      expect(cb.checked).toBe(false)
    }

    // Counter says 0.
    expect(screen.getByText(/0 targets selected/)).toBeInTheDocument()

    // Action labelled "Reset 0 targets" and disabled.
    const action = screen.getByRole("button", { name: /^Reset 0 targets$/ })
    expect(action).toBeDisabled()
  })

  it("selecting one local target enables the action AFTER typing RESET — disabled when only one is true", () => {
    render(<DangerZone />)
    openResetDialog()

    // Initially: 0 selected, no typed string → disabled.
    let action = screen.getByRole("button", { name: /^Reset 0 targets$/ })
    expect(action).toBeDisabled()

    // Select 1 box — counter updates, but typed empty → still disabled.
    fireEvent.click(screen.getByTestId("reset-local-messages"))
    action = screen.getByRole("button", { name: /^Reset 1 target$/ })
    expect(action).toBeDisabled()

    // Type RESET on its own (no selection) → also disabled. Uncheck first.
    fireEvent.click(screen.getByTestId("reset-local-messages"))
    const input = screen.getByLabelText(/Confirm by typing RESET/)
    fireEvent.change(input, { target: { value: "RESET" } })
    action = screen.getByRole("button", { name: /^Reset 0 targets$/ })
    expect(action).toBeDisabled()

    // Both selected + typed → enabled.
    fireEvent.click(screen.getByTestId("reset-local-messages"))
    action = screen.getByRole("button", { name: /^Reset 1 target$/ })
    expect(action).not.toBeDisabled()
  })

  it("selecting messages + channels and typing RESET → action click calls useReset.mutate with the exact body", () => {
    render(<DangerZone />)
    openResetDialog()

    fireEvent.click(screen.getByTestId("reset-local-messages"))
    fireEvent.click(screen.getByTestId("reset-device-channels"))

    const input = screen.getByLabelText(/Confirm by typing RESET/)
    fireEvent.change(input, { target: { value: "RESET" } })

    const action = screen.getByRole("button", { name: /^Reset 2 targets$/ })
    expect(action).not.toBeDisabled()
    fireEvent.click(action)

    expect(resetMutate).toHaveBeenCalledTimes(1)
    const [body] = resetMutate.mock.calls[0]
    expect(body).toEqual({
      local: { messages: true },
      device: { channels: true },
      confirm: "RESET",
    })
  })

  it("selecting only trace_samples + typing RESET → action click calls useReset.mutate with trace_samples=true", () => {
    render(<DangerZone />)
    openResetDialog()

    const cb = screen.getByTestId(
      "reset-local-trace_samples",
    ) as HTMLInputElement
    expect(cb.checked).toBe(false)
    fireEvent.click(cb)
    expect(cb.checked).toBe(true)

    const input = screen.getByLabelText(/Confirm by typing RESET/)
    fireEvent.change(input, { target: { value: "RESET" } })

    const action = screen.getByRole("button", { name: /^Reset 1 target$/ })
    expect(action).not.toBeDisabled()
    fireEvent.click(action)

    expect(resetMutate).toHaveBeenCalledTimes(1)
    const [body] = resetMutate.mock.calls[0]
    expect(body).toEqual({
      local: { trace_samples: true },
      device: {},
      confirm: "RESET",
    })
  })

  it("dialog state resets on close (typed string + selections cleared)", () => {
    render(<DangerZone />)
    openResetDialog()

    fireEvent.click(screen.getByTestId("reset-local-messages"))
    expect(
      (screen.getByTestId("reset-local-messages") as HTMLInputElement).checked,
    ).toBe(true)

    // Cancel closes the dialog.
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }))

    // Reopen and verify the checkbox is unchecked again.
    openResetDialog()
    expect(
      (screen.getByTestId("reset-local-messages") as HTMLInputElement).checked,
    ).toBe(false)
    // Typed input also cleared.
    const input = screen.getByLabelText(
      /Confirm by typing RESET/,
    ) as HTMLInputElement
    expect(input.value).toBe("")
  })
})

describe("DangerZone — factory reset", () => {
  it("factory reset still works (typed FACTORY RESET + checkbox)", () => {
    render(<DangerZone />)
    openFactoryDialog()

    const action = screen.getByRole("button", { name: /^Factory reset$/ })
    expect(action).toBeDisabled()

    const input = screen.getByLabelText(/Confirm by typing FACTORY RESET/)
    const checkbox = screen.getByLabelText(
      /I understand my pubkey will change/,
    ) as HTMLInputElement

    // Only typed → still disabled.
    fireEvent.change(input, { target: { value: "FACTORY RESET" } })
    expect(action).toBeDisabled()

    // Both → enabled.
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(action).not.toBeDisabled()
    fireEvent.click(action)
    expect(factoryMutate).toHaveBeenCalledWith({ confirm: "FACTORY RESET" })
  })
})
