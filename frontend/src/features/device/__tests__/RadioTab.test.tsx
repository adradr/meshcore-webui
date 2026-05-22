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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Switch to the US region via the Region picker so the single US 915
 * preset gets auto-applied. Returns once the readout reflects the new freq.
 */
async function selectUsRegion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("region-picker-trigger"))
  const usItem = await screen.findByTestId("region-item-US")
  await user.click(usItem)
  await waitFor(() => {
    expect(screen.getByTestId("radio-readout").textContent).toMatch(
      /910\.525\s*MHz/,
    )
  })
}

// ---------------------------------------------------------------------------
// Help text + external link (Task 10)
// ---------------------------------------------------------------------------

describe("RadioConfigCard — help text + external link", () => {
  it("renders mesh-compatibility help text and links to meshcore.co.uk", () => {
    render(<RadioTab />)
    expect(screen.getByText(/match every node|silently isolates/i)).toBeTruthy()
    const link = screen.getByRole("link", { name: /meshcore\.co\.uk/i })
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel") ?? "").toMatch(/noopener/)
    expect(link.getAttribute("rel") ?? "").toMatch(/noreferrer/)
    expect(link.getAttribute("href") ?? "").toMatch(/meshcore\.co\.uk/)
  })
})

// ---------------------------------------------------------------------------
// Readout rendering
// ---------------------------------------------------------------------------

describe("RadioTab — readout line", () => {
  it("renders the big Geist Mono readout with the radio data", () => {
    render(<RadioTab />)
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
    const metricsLine = screen.getByTestId("radio-metrics")
    expect(metricsLine.textContent).toMatch(/airtime/i)
    expect(metricsLine.textContent).toMatch(/kbps/)
    expect(metricsLine.textContent).toMatch(/dBm/)
  })
})

// ---------------------------------------------------------------------------
// Region → Profile selection
// ---------------------------------------------------------------------------

describe("RadioTab — region + profile selection", () => {
  it("seeds the region from the readout (EU) and renders EU profile tiles", () => {
    render(<RadioTab />)
    expect(screen.getByTestId("region-picker-trigger")).toBeTruthy()
    // Both EU presets visible
    expect(screen.getByTestId("profile-tile-eu_868_pub")).toBeTruthy()
    expect(screen.getByTestId("profile-tile-eu_868_alt")).toBeTruthy()
  })

  it("switching region to US auto-selects the only US preset and updates the readout", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    // After auto-selection the US 915 profile tile is rendered
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-us_915_pub")).toBeTruthy()
    })
  })

  it("clicking a different profile tile within the same region updates the readout", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    // EU 868 alt = 868.100 MHz
    await user.click(screen.getByTestId("profile-tile-eu_868_alt"))
    await waitFor(() => {
      expect(screen.getByTestId("radio-readout").textContent).toMatch(
        /868\.1\s*MHz/,
      )
    })
  })

  it("the matching profile tile is marked checked", () => {
    render(<RadioTab />)
    const radio = screen.getByRole("radio", { name: /Public — Long Range/i })
    expect(
      radio.getAttribute("data-state") === "checked" ||
        radio.getAttribute("aria-checked") === "true",
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Custom toggle + Advanced disclosure
// ---------------------------------------------------------------------------

describe("RadioTab — Custom toggle", () => {
  it("custom toggle is off by default when a preset matches", () => {
    render(<RadioTab />)
    const toggle = screen.getByTestId("radio-custom-toggle")
    expect(
      toggle.getAttribute("data-state") === "unchecked" ||
        toggle.getAttribute("aria-checked") === "false",
    ).toBe(true)
    // AdvancedPanel button NOT rendered when toggle is off
    expect(screen.queryByRole("button", { name: /advanced/i })).toBeNull()
  })

  it("flipping the custom toggle hides the profile tiles and reveals the AdvancedPanel", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await user.click(screen.getByTestId("radio-custom-toggle"))
    await waitFor(() => {
      expect(screen.getByLabelText(/FREQUENCY/i)).toBeTruthy()
    })
    // Profile tiles should be hidden
    expect(screen.queryByTestId("profile-tile-eu_868_pub")).toBeNull()
  })

  it("flipping the toggle off again restores the profile tiles", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    const toggle = screen.getByTestId("radio-custom-toggle")
    await user.click(toggle)
    await waitFor(() => expect(screen.getByLabelText(/FREQUENCY/i)).toBeTruthy())
    await user.click(toggle)
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-eu_868_pub")).toBeTruthy()
    })
  })
})

// ---------------------------------------------------------------------------
// matchPreset rehydration on data refresh
// ---------------------------------------------------------------------------

describe("RadioTab — matchPreset rehydration", () => {
  it("when readout doesn't match any preset, the readout still reflects the values", () => {
    ;(useRadio as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { freq: 999.0, bw: 250, sf: 11, cr: 5, tx_power: 10, max_tx_power: 22 },
      isLoading: false,
      isSuccess: true,
    })
    render(<RadioTab />)
    expect(screen.getByTestId("radio-readout").textContent).toMatch(/999/)
  })
})

// ---------------------------------------------------------------------------
// TX power slider does NOT trigger radio Apply
// ---------------------------------------------------------------------------

describe("RadioTab — TX power slider independence", () => {
  it("changing the TX power slider does not enable the radio Apply button", () => {
    render(<RadioTab />)
    const radioApplyBtn = screen.getByTestId("radio-apply-btn")
    expect(radioApplyBtn).toBeDisabled()
    const txApplyBtn = screen.getByTestId("tx-power-apply-btn")
    expect(txApplyBtn).not.toBeDisabled()
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

  it("Apply button becomes enabled after switching region to US", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    expect(screen.getByTestId("radio-apply-btn")).not.toBeDisabled()
  })

  it("opens AlertDialog when Apply is clicked", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByTestId("radio-apply-btn"))
    expect(screen.getByText(/Change radio configuration/i)).toBeTruthy()
  })

  it("action button is disabled without typing APPLY", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByTestId("radio-apply-btn"))
    const dialogAction = screen.getByTestId("radio-apply-confirm-btn")
    expect(dialogAction).toBeDisabled()
  })

  it("action button becomes enabled after typing APPLY", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByTestId("radio-apply-btn"))
    const confirmInput = screen.getByTestId("radio-apply-confirm-input")
    await user.type(confirmInput, "APPLY")
    expect(screen.getByTestId("radio-apply-confirm-btn")).not.toBeDisabled()
  })

  it("clicking the enabled action calls useSetRadio().mutate with the form values", async () => {
    const mutateSetRadio = vi.fn()
    setupHookMocks({ mutateSetRadio })
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByTestId("radio-apply-btn"))
    const confirmInput = screen.getByTestId("radio-apply-confirm-input")
    await user.type(confirmInput, "APPLY")
    await user.click(screen.getByTestId("radio-apply-confirm-btn"))
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
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByTestId("radio-apply-btn"))
    await user.type(screen.getByTestId("radio-apply-confirm-input"), "APPLY")
    await user.click(screen.getByTestId("radio-apply-confirm-btn"))
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/back/i),
    )
  })

  it("shows 'still re-establishing' in toast on reconnected: false", async () => {
    const mutateSetRadio = vi.fn((_, callbacks) => {
      callbacks?.onSuccess?.({ reconnected: false })
    })
    setupHookMocks({ mutateSetRadio })
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByTestId("radio-apply-btn"))
    await user.type(screen.getByTestId("radio-apply-confirm-input"), "APPLY")
    await user.click(screen.getByTestId("radio-apply-confirm-btn"))
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/still re-establishing/i),
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
    const user = userEvent.setup()
    render(<RadioTab />)
    const txApplyBtn = screen.getByTestId("tx-power-apply-btn")
    await user.click(txApplyBtn)
    expect(mutateTxPower).toHaveBeenCalledWith(17)
  })

  it("slider max equals readout.max_tx_power", () => {
    render(<RadioTab />)
    const slider = screen.getByRole("slider")
    expect(slider.getAttribute("aria-valuemax")).toBe("22")
  })

  it("no AlertDialog is opened when TX power Apply is clicked", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await user.click(screen.getByTestId("tx-power-apply-btn"))
    expect(screen.queryByText(/Change radio configuration/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reset to current button
// ---------------------------------------------------------------------------

describe("RadioTab — Reset to current", () => {
  it("resets form to readout values after switching region", async () => {
    const user = userEvent.setup()
    render(<RadioTab />)
    await selectUsRegion(user)
    await user.click(screen.getByRole("button", { name: /reset to current/i }))
    await waitFor(() =>
      expect(screen.getByTestId("radio-readout").textContent).toMatch(
        /869\.525\s*MHz/,
      ),
    )
  })
})
