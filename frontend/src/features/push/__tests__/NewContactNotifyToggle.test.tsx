import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const setMutate = vi.fn()

vi.mock("@/features/push/queries", () => ({
  useNewContactNotify: () => ({ data: { enabled: false }, isLoading: false }),
  useSetNewContactNotify: () => ({ mutate: setMutate, isPending: false }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { NewContactNotifyToggle } from "@/features/push/NewContactNotifyToggle"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("NewContactNotifyToggle", () => {
  it("renders the 'New contact alerts' switch (off by default)", () => {
    render(<NewContactNotifyToggle />)
    const toggle = screen.getByRole("switch", { name: /new contact alerts/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute("aria-checked", "false")
  })

  it("toggling on issues the mutation with true", () => {
    render(<NewContactNotifyToggle />)
    const toggle = screen.getByRole("switch", { name: /new contact alerts/i })
    fireEvent.click(toggle)
    expect(setMutate).toHaveBeenCalledTimes(1)
    expect(setMutate.mock.calls[0][0]).toBe(true)
  })
})
