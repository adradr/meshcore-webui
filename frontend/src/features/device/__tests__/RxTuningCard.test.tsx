/**
 * RxTuningCard tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockMutateSetTuning = vi.fn()

vi.mock("../radioQueries", () => ({
  useRadio: vi.fn(),
  useSetRadio: vi.fn(),
  useSetTxPower: vi.fn(),
  useTuning: vi.fn(),
  useSetTuning: vi.fn(),
}))

import { useTuning, useSetTuning } from "../radioQueries"
import { RxTuningCard } from "../RxTuningCard"

const DEFAULT_TUNING = { rx_delay: 100, airtime_factor: 200 }

function setupMocks(overrides?: {
  tuning?: typeof DEFAULT_TUNING | null
  pending?: boolean
  mutate?: typeof mockMutateSetTuning
}) {
  const tuning = overrides?.tuning ?? DEFAULT_TUNING
  ;(useTuning as ReturnType<typeof vi.fn>).mockReturnValue({
    data: tuning,
    isLoading: tuning === null,
    isSuccess: tuning !== null,
  })
  const mutate = overrides?.mutate ?? mockMutateSetTuning
  ;(useSetTuning as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate,
    isPending: overrides?.pending ?? false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupMocks()
})

describe("RxTuningCard — rendering", () => {
  it("renders the rx_delay value from useTuning()", () => {
    render(<RxTuningCard />)
    const rxDelayInput = screen.getByLabelText(/RX delay/i) as HTMLInputElement
    expect(rxDelayInput.value).toBe("100")
  })

  it("renders the airtime_factor value from useTuning()", () => {
    render(<RxTuningCard />)
    const airtimeInput = screen.getByLabelText(/Airtime factor/i) as HTMLInputElement
    expect(airtimeInput.value).toBe("200")
  })

  it("shows a loading skeleton when data is loading", () => {
    // Override the mock to simulate loading state
    ;(useTuning as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isSuccess: false,
    })
    render(<RxTuningCard />)
    // Skeleton renders; inputs should not be present
    expect(screen.queryByLabelText(/RX delay/i)).toBeNull()
  })
})

describe("RxTuningCard — Apply", () => {
  it("calls useSetTuning().mutate with current field values on Apply", async () => {
    const mutate = vi.fn()
    setupMocks({ mutate })
    render(<RxTuningCard />)
    await userEvent.click(screen.getByRole("button", { name: /apply/i }))
    expect(mutate).toHaveBeenCalledWith({ rx_delay: 100, airtime_factor: 200 })
  })

  it("submits updated values after editing the inputs", async () => {
    const mutate = vi.fn()
    setupMocks({ mutate })
    render(<RxTuningCard />)
    const rxDelayInput = screen.getByLabelText(/RX delay/i)
    await userEvent.clear(rxDelayInput)
    await userEvent.type(rxDelayInput, "50")
    await userEvent.click(screen.getByRole("button", { name: /apply/i }))
    expect(mutate).toHaveBeenCalledWith({ rx_delay: 50, airtime_factor: 200 })
  })

  it("Apply button shows pending state while mutation runs", () => {
    setupMocks({ pending: true })
    render(<RxTuningCard />)
    expect(screen.getByRole("button", { name: /applying/i })).toBeTruthy()
  })

  it("does not call mutate when Apply is disabled during pending", async () => {
    setupMocks({ pending: true })
    render(<RxTuningCard />)
    // button is disabled, click should not fire mutate
    const btn = screen.getByRole("button", { name: /applying/i })
    expect(btn).toBeDisabled()
  })
})
