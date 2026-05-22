/**
 * BehaviourTab.test.tsx
 *
 * One render-from-mock test + one save-roundtrip test per card.
 * All query hooks are mocked at module level so tests stay fast.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// ---------- mock behaviour query hooks ----------
const mockSetDeviceName = vi.fn()
const mockUpdatePolicy = vi.fn()
const mockSetBlePin = vi.fn()
const mockSetCustomVar = vi.fn()
const mockSyncTime = vi.fn()
const mockInvalidateQueries = vi.fn()

vi.mock("../behaviourQueries", () => ({
  useSetDeviceName: vi.fn(),
  useUpdatePolicy: vi.fn(),
  useSetBlePin: vi.fn(),
  useCustomVars: vi.fn(),
  useSetCustomVar: vi.fn(),
  useDeviceTime: vi.fn(),
  useSyncDeviceTime: vi.fn(),
}))

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>()
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
  }
})

// ---------- mock device queries (useSelfInfo / useDeviceStatus) ----------
vi.mock("../queries", () => ({
  useSelfInfo: vi.fn(),
  useDeviceStatus: vi.fn(),
  useRadioConnected: vi.fn(),
  useDeviceInfo: vi.fn(),
  useSendAdvert: vi.fn(),
  useSetPosition: vi.fn(),
}))

import {
  useSetDeviceName,
  useUpdatePolicy,
  useSetBlePin,
  useCustomVars,
  useSetCustomVar,
  useDeviceTime,
  useSyncDeviceTime,
} from "../behaviourQueries"
import { useSelfInfo } from "../queries"
import { BehaviourTab } from "../BehaviourTab"
import { IdentityCard } from "../IdentityCard"
import { TelemetryCard } from "../TelemetryCard"
import { AdvertPolicyCard } from "../AdvertPolicyCard"
import { BlePinCard } from "../BlePinCard"
import { CustomVarsCard } from "../CustomVarsCard"
import { TimeSyncCard } from "../TimeSyncCard"

const MOCK_SELF_INFO = {
  name: "Wikingstone-Repeater-3",
  public_key: "7a3f1234567890abcdef1234567890ab7a3f1234567890abcdef1234567890ab12",
  adv_lat: 47.5,
  adv_lon: 19.0,
  adv_loc_policy: 2,
  multi_acks: 1,
  telemetry_mode_base: 1,
  telemetry_mode_loc: 2,
  telemetry_mode_env: 0,
  manual_add_contacts: false,
  radio_freq: 869.525,
  radio_bw: 250,
  radio_sf: 11,
  radio_cr: 5,
  tx_power: 22,
  max_tx_power: 22,
}

const MOCK_TIME = {
  device_epoch: 1748000000,
  server_epoch: 1748000003,
  skew_s: -3,
}

function setupMocks() {
  ;(useSelfInfo as ReturnType<typeof vi.fn>).mockReturnValue({
    data: MOCK_SELF_INFO,
    isLoading: false,
  })
  ;(useSetDeviceName as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mockSetDeviceName,
    isPending: false,
  })
  ;(useUpdatePolicy as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mockUpdatePolicy,
    isPending: false,
  })
  ;(useSetBlePin as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mockSetBlePin,
    isPending: false,
  })
  ;(useCustomVars as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { rx_offset_hz: -1300, notes: "test rig" },
    isLoading: false,
  })
  ;(useSetCustomVar as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mockSetCustomVar,
    isPending: false,
  })
  ;(useDeviceTime as ReturnType<typeof vi.fn>).mockReturnValue({
    data: MOCK_TIME,
    isLoading: false,
  })
  ;(useSyncDeviceTime as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: mockSyncTime,
    isPending: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupMocks()
})

// ===========================================================================
// IdentityCard
// ===========================================================================

describe("IdentityCard — render", () => {
  it("shows device name and truncated public key in view mode", () => {
    render(<IdentityCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    expect(screen.getByTestId("identity-name-display").textContent).toBe(
      "Wikingstone-Repeater-3",
    )
    // truncated key: first 8 + "…" + last 8
    expect(screen.getByText(/7a3f1234/)).toBeTruthy()
  })

  it("shows Edit button in view mode", () => {
    render(<IdentityCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    expect(screen.getByRole("button", { name: /edit device name/i })).toBeTruthy()
  })
})

describe("IdentityCard — save roundtrip", () => {
  it("calls useSetDeviceName().mutate with the new name on save", async () => {
    const mutate = vi.fn((_body, opts) => opts?.onSuccess?.())
    ;(useSetDeviceName as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<IdentityCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    await userEvent.click(screen.getByRole("button", { name: /edit device name/i }))
    const input = screen.getByTestId("identity-name-input")
    await userEvent.clear(input)
    await userEvent.type(input, "NewName")
    await userEvent.click(screen.getByTestId("identity-save-btn"))
    expect(mutate).toHaveBeenCalledWith(
      { name: "NewName" },
      expect.anything(),
    )
  })

  it("does not call mutate if name is empty", async () => {
    const mutate = vi.fn()
    ;(useSetDeviceName as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<IdentityCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    await userEvent.click(screen.getByRole("button", { name: /edit device name/i }))
    const input = screen.getByTestId("identity-name-input")
    await userEvent.clear(input)
    expect(screen.getByTestId("identity-save-btn")).toBeDisabled()
  })
})

// ===========================================================================
// TelemetryCard
// ===========================================================================

describe("TelemetryCard — render", () => {
  it("shows current telemetry mode labels in view mode", () => {
    render(<TelemetryCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    // base=1 → "Owner only", loc=2 → "Starred contacts", env=0 → "Off"
    expect(screen.getByTestId("telemetry-base-display").textContent).toBe("Owner only")
    expect(screen.getByTestId("telemetry-location-display").textContent).toBe(
      "Starred contacts",
    )
    expect(screen.getByTestId("telemetry-environment-display").textContent).toBe("Off")
  })
})

describe("TelemetryCard — save roundtrip", () => {
  it("calls useUpdatePolicy with only changed telemetry fields", async () => {
    const mutate = vi.fn((_body, opts) => opts?.onSuccess?.())
    ;(useUpdatePolicy as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<TelemetryCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    await userEvent.click(screen.getByRole("button", { name: /edit telemetry modes/i }))

    // Save immediately (no changes = empty patch, but still calls mutate)
    await userEvent.click(screen.getByTestId("telemetry-save-btn"))
    // Empty patch (no changes)
    expect(mutate).toHaveBeenCalledWith(
      { telemetry: {} },
      expect.anything(),
    )
  })
})

// ===========================================================================
// AdvertPolicyCard
// ===========================================================================

describe("AdvertPolicyCard — render", () => {
  it("shows adv_loc_policy, manual_add_contacts, multi_acks in view mode", () => {
    render(<AdvertPolicyCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    expect(screen.getByText("2")).toBeTruthy() // adv_loc_policy
    expect(screen.getByText("Off")).toBeTruthy() // manual_add_contacts=false
    expect(screen.getByText("1")).toBeTruthy() // multi_acks
  })
})

describe("AdvertPolicyCard — save roundtrip", () => {
  it("calls useUpdatePolicy with changed adv_loc_policy", async () => {
    const mutate = vi.fn((_body, opts) => opts?.onSuccess?.())
    ;(useUpdatePolicy as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<AdvertPolicyCard selfInfo={MOCK_SELF_INFO} isLoading={false} />)
    await userEvent.click(screen.getByRole("button", { name: /edit advert policy/i }))

    const advInput = screen.getByTestId("adv-loc-policy-input")
    await userEvent.clear(advInput)
    await userEvent.type(advInput, "10")

    await userEvent.click(screen.getByTestId("advert-policy-save-btn"))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ adv_loc_policy: 10 }),
      expect.anything(),
    )
  })
})

// ===========================================================================
// BlePinCard
// ===========================================================================

describe("BlePinCard — render", () => {
  it("shows the write-only description in collapsed state", () => {
    render(<BlePinCard />)
    expect(screen.getByText(/write-only/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /set ble pin/i })).toBeTruthy()
  })
})

describe("BlePinCard — save roundtrip", () => {
  it("calls useSetBlePin with the numeric PIN on save", async () => {
    const mutate = vi.fn((_body, opts) => opts?.onSuccess?.())
    ;(useSetBlePin as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<BlePinCard />)
    await userEvent.click(screen.getByRole("button", { name: /set ble pin/i }))
    const input = screen.getByTestId("ble-pin-input")
    await userEvent.type(input, "123456")
    await userEvent.click(screen.getByTestId("ble-pin-save-btn"))
    expect(mutate).toHaveBeenCalledWith({ pin: 123456 }, expect.anything())
  })

  it("save button is disabled for invalid PIN", async () => {
    render(<BlePinCard />)
    await userEvent.click(screen.getByRole("button", { name: /set ble pin/i }))
    // Empty input → Save PIN button disabled
    expect(screen.getByTestId("ble-pin-save-btn")).toBeDisabled()
  })
})

// ===========================================================================
// CustomVarsCard
// ===========================================================================

describe("CustomVarsCard — render", () => {
  it("renders existing custom variable rows", () => {
    render(<CustomVarsCard />)
    expect(screen.getByTestId("custom-var-row-rx_offset_hz")).toBeTruthy()
    expect(screen.getByTestId("custom-var-row-notes")).toBeTruthy()
  })

  it("renders delete buttons for each row", () => {
    render(<CustomVarsCard />)
    expect(screen.getByTestId("custom-var-delete-rx_offset_hz")).toBeTruthy()
  })
})

describe("CustomVarsCard — save roundtrip (add row)", () => {
  it("calls useSetCustomVar with coerced number value", async () => {
    const mutate = vi.fn((_body, opts) => opts?.onSaved?.())
    ;(useSetCustomVar as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<CustomVarsCard />)
    await userEvent.click(screen.getByRole("button", { name: /add custom variable/i }))
    await userEvent.type(screen.getByTestId("custom-var-new-key"), "gain")
    await userEvent.type(screen.getByTestId("custom-var-new-value"), "-5")
    await userEvent.click(screen.getByTestId("custom-var-add-save-btn"))
    expect(mutate).toHaveBeenCalledWith(
      { key: "gain", value: -5 },
      expect.anything(),
    )
  })

  it("calls useSetCustomVar with string value when not numeric", async () => {
    const mutate = vi.fn((_body, opts) => opts?.onSaved?.())
    ;(useSetCustomVar as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<CustomVarsCard />)
    await userEvent.click(screen.getByRole("button", { name: /add custom variable/i }))
    await userEvent.type(screen.getByTestId("custom-var-new-key"), "label")
    await userEvent.type(screen.getByTestId("custom-var-new-value"), "test rig")
    await userEvent.click(screen.getByTestId("custom-var-add-save-btn"))
    expect(mutate).toHaveBeenCalledWith(
      { key: "label", value: "test rig" },
      expect.anything(),
    )
  })

  it("soft-deletes a row by setting value to empty string", async () => {
    const mutate = vi.fn()
    ;(useSetCustomVar as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<CustomVarsCard />)
    await userEvent.click(screen.getByTestId("custom-var-delete-rx_offset_hz"))
    expect(mutate).toHaveBeenCalledWith({ key: "rx_offset_hz", value: "" })
  })
})

// ===========================================================================
// TimeSyncCard
// ===========================================================================

describe("TimeSyncCard — render", () => {
  it("renders device time, server time, and skew", () => {
    render(<TimeSyncCard />)
    // device_epoch 1748000000 → some UTC string containing the year
    expect(screen.getByTestId("time-device-display").textContent).toMatch(/UTC/)
    expect(screen.getByTestId("time-server-display").textContent).toMatch(/UTC/)
    // skew -3 → "device behind server"
    expect(screen.getByTestId("time-skew-display").textContent).toMatch(
      /device behind server/i,
    )
  })

  it("Sync to server button calls useSyncDeviceTime().mutate()", async () => {
    const mutate = vi.fn()
    ;(useSyncDeviceTime as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate,
      isPending: false,
    })
    render(<TimeSyncCard />)
    await userEvent.click(screen.getByTestId("time-sync-btn"))
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it("Refresh button calls invalidateQueries for device/time", async () => {
    render(<TimeSyncCard />)
    await userEvent.click(screen.getByTestId("time-refresh-btn"))
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["device", "time"],
    })
  })
})

// ===========================================================================
// BehaviourTab integration — all 6 cards render
// ===========================================================================

describe("BehaviourTab", () => {
  it("renders all 6 cards without crashing", () => {
    render(<BehaviourTab />)
    // Identity
    expect(screen.getByText("Identity")).toBeTruthy()
    // Telemetry
    expect(screen.getByText("Telemetry modes")).toBeTruthy()
    // Advert policy
    expect(screen.getByText("Advert + ack policy")).toBeTruthy()
    // BLE PIN
    expect(screen.getByText("BLE pairing PIN")).toBeTruthy()
    // Custom vars
    expect(screen.getByText("Custom variables")).toBeTruthy()
    // Time sync
    expect(screen.getByText("Time sync")).toBeTruthy()
  })
})
