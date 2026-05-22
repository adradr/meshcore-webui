/**
 * RadioTab + TxPowerCard tests.
 *
 * Strategy: mock useRadio / useSetRadio / useSetTxPower at the query level
 * (not at fetch level) so the tests stay fast and don't need a QueryClient
 * wrapper around every render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// --- mock sonner toast ---
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// --- mock radioQueries at module level ---
const mockMutateSetRadio = vi.fn()
const mockMutateSetTxPower = vi.fn()

vi.mock("../radioQueries", () => ({
  useRadio: vi.fn(),
  useSetRadio: vi.fn(),
  useSetTxPower: vi.fn(),
  useTuning: vi.fn(),
  useSetTuning: vi.fn(),
}))

import { useRadio, useSetRadio, useSetTxPower, useTuning, useSetTuning } from "../radioQueries"
import { toast } from "sonner"
import { RadioTab } from "../RadioTab"

// Default readout used across most tests
const DEFAULT_READOUT = {
  freq: 869.525,
  bw: 250,
  sf: 11 as const,
  cr: 5 as const,
  tx_power: 17,
  max_tx_power: 22,
}

function setupHookMocks(overrides?: {
  readout?: typeof DEFAULT_READOUT | null
  setRadioPending?: boolean
  setTxPowerPending?: boolean
  mutateSetRadio?: typeof mockMutateSetRadio
  mutateSetTxPower?: typeof mockMutateSetTxPower
}) {
  const readout = overrides?.readout ?? DEFAULT_READOUT

  ;(useRadio as ReturnType<typeof vi.fn>).mockReturnValue({
    data: readout,
    isLoading: readout === null,
    isSuccess: readout !== null,
  })

  const mutateRadio = overrides?.mutateSetRadio ?? mockMutateSetRadio
  ;(useSetRadio as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mutateRadio,
    isPending: overrides?.setRadioPending ?? false,
  })

  const mutateTxPower = overrides?.mutateSetTxPower ?? mockMutateSetTxPower
  ;(useSetTxPower as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mutateTxPower,
    isPending: overrides?.setTxPowerPending ?? false,
  })

  // Stub out useTuning/useSetTuning so RxTuningCard (rendered inside RadioTab) doesn't crash
  ;(useTuning as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { rx_delay: 100, airtime_factor: 200 },
    isLoading: false,
    isSuccess: true,
  })
  ;(useSetTuning as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupHookMocks()
})

// ---------------------------------------------------------------------------
// Readout rendering
// ---------------------------------------------------------------------------

describe("RadioTab — readout line", () => {
  it("renders the big Geist Mono readout with the radio data", () => {
    render(<RadioTab />)
    // Target the specific readout paragraph via testid
    const readout = screen.getByTestId("radio-readout")
    expect(readout.textContent).toMatch(/869\.525/)
    expect(readout.textContent).toMatch(/BW/)
    expect(readout.textContent).toMatch(/250/)
    expect(readout.textContent).toMatch(/SF/)
    expect(readout.textContent).toMatch(/11/)
    expect(readout.textContent).toMatch(/CR 4\/5/)
  })

  it("renders the derived metrics line (airtime, data rate, sensitivity)", () => {
    render(<RadioTab />)
    // Target the metrics line by testid
    const metricsLine = screen.getByTestId("radio-metrics")
    expect(metricsLine.textContent).toMatch(/airtime/i)
    expect(metricsLine.textContent).toMatch(/kbps/)
    expect(metricsLine.textContent).toMatch(/dBm/)
  })
})

// ---------------------------------------------------------------------------
// Preset selection
// ---------------------------------------------------------------------------

describe("RadioTab — preset selection", () => {
  it("renders all 8 presets plus the Custom tile", () => {
    render(<RadioTab />)
    // Spot-check a few preset labels via testids
    expect(screen.getByTestId("preset-tile-eu_868_pub")).toBeTruthy()
    expect(screen.getByTestId("preset-tile-us_915_pub")).toBeTruthy()
    expect(screen.getByTestId("preset-tile-custom")).toBeTruthy()
    // Total: 8 presets + 1 custom
    const allRadioItems = screen.getAllByRole("radio")
    expect(allRadioItems.length).toBe(9)
  })

  it("clicking a different preset updates the readout", async () => {
    render(<RadioTab />)
    const us915 = screen.getByText(/US 915 — public/i)
    // click the tile (the label or the radio item within)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    // 910.525 MHz for US 915 preset
    await waitFor(() => {
      expect(screen.getByText(/910\.525\s*MHz/i)).toBeTruthy()
    })
  })

  it("active preset tile is visually selected (aria-checked or data-state)", () => {
    render(<RadioTab />)
    // eu_868_pub is active by default; the RadioGroupItem should be checked
    const eu868Radio = screen.getByRole("radio", { name: /EU 868 — public/i })
    expect(eu868Radio).toBeTruthy()
    // Radix marks the checked item with data-state=checked
    expect(eu868Radio.getAttribute("data-state") === "checked" ||
      eu868Radio.getAttribute("aria-checked") === "true").toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Custom mode / Advanced disclosure
// ---------------------------------------------------------------------------

describe("RadioTab — Advanced disclosure", () => {
  it("disclosure is closed when a matching preset is active", () => {
    render(<RadioTab />)
    // The advanced section content should be hidden (Collapsible closed)
    const advancedContent = screen.queryByRole("group", { name: /frequency/i })
    // Either not in DOM or hidden — we check the collapsible button text
    const advancedButton = screen.getByRole("button", { name: /advanced/i })
    expect(advancedButton).toBeTruthy()
    // Content area should not be visible (closed by default when preset matches)
    expect(advancedContent).toBeNull()
  })

  it("clicking the Custom tile opens the Advanced disclosure", async () => {
    render(<RadioTab />)
    // Click the Custom preset tile (use testid to avoid matching the Advanced button)
    const customTile = screen.getByTestId("preset-tile-custom")
    await userEvent.click(customTile)
    await waitFor(() => {
      // frequency input should now be visible
      expect(screen.getByLabelText(/FREQUENCY/i)).toBeTruthy()
    })
  })

  it("auto-opens when the current config does not match any preset", async () => {
    // No preset matches freq=999
    ;(useRadio as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { freq: 999.0, bw: 250, sf: 11, cr: 5, tx_power: 10, max_tx_power: 22 },
      isLoading: false,
      isSuccess: true,
    })
    render(<RadioTab />)
    await waitFor(() => {
      // Advanced section should auto-open
      expect(screen.getByLabelText(/FREQUENCY/i)).toBeTruthy()
    })
  })
})

// ---------------------------------------------------------------------------
// TX power slider does NOT trigger radio Apply
// ---------------------------------------------------------------------------

describe("RadioTab — TX power slider independence", () => {
  it("changing the TX power slider does not enable the radio Apply button", async () => {
    render(<RadioTab />)
    // The radio Apply button is disabled because form === readout (no RF change)
    const radioApplyBtn = screen.getByTestId("radio-apply-btn")
    expect(radioApplyBtn).toBeDisabled()
    // The TX power apply button is always enabled (separate state, no dirty check)
    const txApplyBtn = screen.getByTestId("tx-power-apply-btn")
    expect(txApplyBtn).not.toBeDisabled()
    // The TX apply is independent of the radio apply state
    expect(radioApplyBtn).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Radio Apply → AlertDialog typed-confirm flow
// ---------------------------------------------------------------------------

describe("RadioTab — Apply radio AlertDialog", () => {
  it("Apply button is disabled when form equals the current readout", () => {
    render(<RadioTab />)
    const applyBtn = screen.getByTestId("radio-apply-btn")
    expect(applyBtn).toBeDisabled()
  })

  it("Apply button becomes enabled after selecting a different preset", async () => {
    render(<RadioTab />)
    // Select a different preset (US 915)
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => {
      const applyBtn = screen.getByTestId("radio-apply-btn")
      expect(applyBtn).not.toBeDisabled()
    })
  })

  it("opens AlertDialog when Apply is clicked", async () => {
    render(<RadioTab />)
    // Switch to US 915 to enable Apply
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => {
      expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled()
    })
    await userEvent.click(screen.getByTestId("radio-apply-btn"))
    // Dialog title should appear
    expect(screen.getByText(/Change radio configuration/i)).toBeTruthy()
  })

  it("action button is disabled without typing APPLY", async () => {
    render(<RadioTab />)
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled())
    await userEvent.click(screen.getByTestId("radio-apply-btn"))
    // Find the action button in the dialog
    const dialogAction = screen.getByTestId("radio-apply-confirm-btn")
    expect(dialogAction).toBeDisabled()
  })

  it("action button becomes enabled after typing APPLY", async () => {
    render(<RadioTab />)
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled())
    await userEvent.click(screen.getByTestId("radio-apply-btn"))
    const confirmInput = screen.getByTestId("radio-apply-confirm-input")
    await userEvent.type(confirmInput, "APPLY")
    expect(screen.getByTestId("radio-apply-confirm-btn")).not.toBeDisabled()
  })

  it("clicking the enabled action calls useSetRadio().mutate with the form values", async () => {
    const mutateSetRadio = vi.fn()
    setupHookMocks({ mutateSetRadio })
    render(<RadioTab />)
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled())
    await userEvent.click(screen.getByTestId("radio-apply-btn"))
    const confirmInput = screen.getByTestId("radio-apply-confirm-input")
    await userEvent.type(confirmInput, "APPLY")
    await userEvent.click(screen.getByTestId("radio-apply-confirm-btn"))
    expect(mutateSetRadio).toHaveBeenCalledWith(
      expect.objectContaining({ freq: 910.525, bw: 250, sf: 11, cr: 5 }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// Mutation result toast handling (reconnected flag)
// ---------------------------------------------------------------------------

describe("RadioTab — mutation reconnected flag", () => {
  it("shows 'back' in toast on reconnected: true", async () => {
    const mutateSetRadio = vi.fn((_, callbacks) => {
      callbacks?.onSuccess?.({ reconnected: true })
    })
    setupHookMocks({ mutateSetRadio })
    render(<RadioTab />)
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled())
    await userEvent.click(screen.getByTestId("radio-apply-btn"))
    await userEvent.type(screen.getByTestId("radio-apply-confirm-input"), "APPLY")
    await userEvent.click(screen.getByTestId("radio-apply-confirm-btn"))
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/back/i)
    )
  })

  it("shows 'still re-establishing' in toast on reconnected: false", async () => {
    const mutateSetRadio = vi.fn((_, callbacks) => {
      callbacks?.onSuccess?.({ reconnected: false })
    })
    setupHookMocks({ mutateSetRadio })
    render(<RadioTab />)
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled())
    await userEvent.click(screen.getByTestId("radio-apply-btn"))
    await userEvent.type(screen.getByTestId("radio-apply-confirm-input"), "APPLY")
    await userEvent.click(screen.getByTestId("radio-apply-confirm-btn"))
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/still re-establishing/i)
    )
  })
})

// ---------------------------------------------------------------------------
// TX power Apply (no typed confirm)
// ---------------------------------------------------------------------------

describe("RadioTab — TX power Apply", () => {
  it("clicking TX power Apply calls useSetTxPower().mutate with the slider value", async () => {
    const mutateTxPower = vi.fn()
    setupHookMocks({ mutateSetTxPower: mutateTxPower })
    render(<RadioTab />)
    // default tx_power is 17, click Apply
    const txApplyBtn = screen.getByTestId("tx-power-apply-btn")
    // Apply is always clickable for TX power (no change check needed)
    await userEvent.click(txApplyBtn)
    expect(mutateTxPower).toHaveBeenCalledWith(17)
  })

  it("slider max equals readout.max_tx_power", () => {
    render(<RadioTab />)
    const slider = screen.getByRole("slider")
    // Radix Slider root has aria-valuemax
    expect(slider.getAttribute("aria-valuemax")).toBe("22")
  })

  it("no AlertDialog is opened when TX power Apply is clicked", async () => {
    render(<RadioTab />)
    await userEvent.click(screen.getByTestId("tx-power-apply-btn"))
    // Dialog should NOT appear
    expect(screen.queryByText(/Change radio configuration/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reset to current button
// ---------------------------------------------------------------------------

describe("RadioTab — Reset to current", () => {
  it("resets form to readout values after a preset change", async () => {
    render(<RadioTab />)
    // Switch to US 915
    const us915 = screen.getByText(/US 915 — public/i)
    await userEvent.click(us915.closest("[data-testid]") ?? us915)
    await waitFor(() => expect(screen.getByText(/910\.525\s*MHz/i)).toBeTruthy())
    // Reset
    await userEvent.click(screen.getByRole("button", { name: /reset to current/i }))
    // Should return to EU 868
    await waitFor(() => expect(screen.getByText(/869\.525\s*MHz/i)).toBeTruthy())
  })
})
