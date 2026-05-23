import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Capture the mutate fn + tweak isPending per-test by reassigning the
// shared mutation shape. Keep the reference stable so re-renders inside a
// test still see the same spy.
const purgeMutate = vi.fn()
let purgePending = false

vi.mock("@/features/attachments/queries", () => ({
  usePurgeAttachments: () => ({ mutate: purgeMutate, isPending: purgePending }),
}))

import { PurgeConfirmModal } from "../PurgeConfirmModal"

beforeEach(() => {
  vi.clearAllMocks()
  purgePending = false
})

describe("PurgeConfirmModal — typed PURGE confirmation", () => {
  it("renders the title with the total count and a destructive description", () => {
    render(
      <PurgeConfirmModal totalCount={12} open onClose={() => {}} />,
    )
    expect(
      screen.getByText(/Delete all 12 attachments/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Already-sent message links will break/i),
    ).toBeInTheDocument()
  })

  it("'Delete all' is disabled until the user types PURGE", () => {
    render(
      <PurgeConfirmModal totalCount={5} open onClose={() => {}} />,
    )
    const action = screen.getByRole("button", { name: /^Delete all$/ })
    expect(action).toBeDisabled()

    const input = screen.getByLabelText(/Confirm by typing PURGE/)
    // Partial / wrong tokens stay disabled.
    fireEvent.change(input, { target: { value: "PURG" } })
    expect(action).toBeDisabled()
    fireEvent.change(input, { target: { value: "purge" } })
    expect(action).toBeDisabled()

    // Exact match enables.
    fireEvent.change(input, { target: { value: "PURGE" } })
    expect(action).not.toBeDisabled()
  })

  it("clicking 'Delete all' calls usePurgeAttachments and closes on success", () => {
    const onClose = vi.fn()
    render(
      <PurgeConfirmModal totalCount={3} open onClose={onClose} />,
    )

    const input = screen.getByLabelText(/Confirm by typing PURGE/)
    fireEvent.change(input, { target: { value: "PURGE" } })

    const action = screen.getByRole("button", { name: /^Delete all$/ })
    fireEvent.click(action)

    expect(purgeMutate).toHaveBeenCalledTimes(1)
    // mutate(undefined, { onSuccess })
    const [arg, opts] = purgeMutate.mock.calls[0]
    expect(arg).toBeUndefined()
    expect(typeof opts.onSuccess).toBe("function")

    // Invoking the captured onSuccess closes the modal via the parent.
    opts.onSuccess()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Cancel calls onClose without firing the mutation", () => {
    const onClose = vi.fn()
    render(
      <PurgeConfirmModal totalCount={3} open onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }))
    expect(purgeMutate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
