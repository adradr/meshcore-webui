/**
 * Device page — cross-tab integration smoke test.
 *
 * Strategy:
 *   - Mock the network layer (`api.get` / `api.post`) so the hooks run for
 *     real (no per-hook stubs). This exercises the wiring: query→state→
 *     render across Overview / Radio / Behaviour tabs.
 *   - DOM-heavy modules unrelated to the surface under test
 *     (react-leaflet, uplot, the realtime WS, noise samples) are stubbed
 *     to keep the test in jsdom.
 *   - Sonner is silenced.
 *
 * This is intentionally a single end-to-end-shaped test that walks the
 * user path; per-component behaviour is covered by the focused tests in
 * `features/device/__tests__/*`.
 */
import type React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Routes, Route } from "react-router-dom"

// -- Silence sonner toasts (and let us assert on them) ---------------------
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// -- Mock the api layer (the source of all backend traffic) ----------------
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  isApiError: (e: unknown): boolean => e instanceof Error && "status" in e,
}))

// -- Realtime WS — DevicePage's ConnectionBadge reads `status` from here ---
vi.mock("@/realtime/WebSocketProvider", async () => {
  const actual = await vi.importActual<
    typeof import("@/realtime/WebSocketProvider")
  >("@/realtime/WebSocketProvider")
  return {
    ...actual,
    useRealtime: () => ({
      status: "open",
      subscribe: () => () => {},
    }),
  }
})

// -- Noise tab uses uPlot; the RxLog tab has its own fetch on mount.
// We don't switch into those tabs in the test but they're `forceMount`ed
// in the DOM, so we need cheap stubs.
vi.mock("@/features/noise/api", () => ({
  useNoiseSamples: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock("uplot-react", () => ({ default: () => null }))

// react-leaflet pulls in DOM APIs jsdom can't satisfy. The PositionPicker
// only mounts when the user enters edit mode, but we replace its module
// regardless so a brushed-past click never hard-crashes the test.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="leaflet-map">{children}</div>
  ),
  TileLayer: () => null,
  Marker: () => null,
  useMap: () => ({
    panTo: () => {},
    setView: () => {},
    getCenter: () => ({ lat: 0, lng: 0 }),
    getZoom: () => 1,
  }),
  useMapEvents: () => ({}),
}))

import { api } from "@/lib/api"
import { DevicePage } from "../device"

// -------------------------------------------------------------------------
// Mock backend payloads
// -------------------------------------------------------------------------

const STATUS_RESPONSE = { connected: true, host: "192.168.4.1", port: 5000 }

const INFO_RESPONSE = {
  model: "T3-S3",
  ver: "1.7.0",
  fw_build: "20260101",
  max_contacts: 100,
  max_channels: 8,
  ble_pin: 0,
  repeat: false,
}

const SELF_INFO_RESPONSE = {
  name: "Test-Node",
  public_key: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  adv_lat: 47.5,
  adv_lon: 19.05,
  adv_loc_policy: 0,
  multi_acks: 1,
  telemetry_mode_base: 0,
  telemetry_mode_loc: 0,
  telemetry_mode_env: 0,
  manual_add_contacts: false,
  radio_freq: 869.525,
  radio_bw: 250,
  radio_sf: 11,
  radio_cr: 5,
  tx_power: 17,
  max_tx_power: 22,
}

const RADIO_RESPONSE = {
  freq: 869.525,
  bw: 250,
  sf: 11,
  cr: 5,
  tx_power: 17,
  max_tx_power: 22,
}

const TUNING_RESPONSE = { rx_delay: 100, airtime_factor: 200 }

const TIME_RESPONSE = {
  device_epoch: 1_700_000_000,
  server_epoch: 1_700_000_000,
  skew_s: 0,
}

// -------------------------------------------------------------------------
// Test setup
// -------------------------------------------------------------------------

/** Wire up the api.get mock to dispatch by URL. */
function installApiGet() {
  ;(api.get as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string) => {
      if (path === "/api/device/status") return Promise.resolve(STATUS_RESPONSE)
      if (path === "/api/device/info") return Promise.resolve(INFO_RESPONSE)
      if (path === "/api/device/self-info")
        return Promise.resolve(SELF_INFO_RESPONSE)
      if (path === "/api/device/radio") return Promise.resolve(RADIO_RESPONSE)
      if (path === "/api/device/tuning") return Promise.resolve(TUNING_RESPONSE)
      if (path === "/api/device/time") return Promise.resolve(TIME_RESPONSE)
      if (path === "/api/device/custom-vars") return Promise.resolve({})
      return Promise.reject(new Error(`Unmocked GET ${path}`))
    },
  )
}

/** Wire up api.post — most are not exercised; radio Apply needs a small delay. */
function installApiPost() {
  ;(api.post as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string) => {
      if (path === "/api/device/radio") {
        // Short delay so the test could (in principle) observe the
        // "Re-tuning…" pending state.
        return new Promise((resolve) =>
          setTimeout(() => resolve({ reconnected: true }), 10),
        )
      }
      return Promise.resolve(undefined)
    },
  )
}

function renderDevicePage(initialPath = "/device") {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/device" element={<DevicePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  installApiGet()
  installApiPost()
})

// -------------------------------------------------------------------------
// The integration test
// -------------------------------------------------------------------------

describe("DevicePage integration — cross-tab wiring", () => {
  it("walks Overview → Radio (preset swap + Apply) → Behaviour end-to-end", async () => {
    const user = userEvent.setup()
    renderDevicePage()

    // ---- 1. Overview tab is the default and renders the device card. -----
    expect(
      screen.getByRole("tab", { name: /^overview$/i }),
    ).toHaveAttribute("aria-selected", "true")

    // The Overview card pulls from self-info — wait for the name to land.
    await waitFor(() =>
      expect(screen.getByText("Test-Node")).toBeInTheDocument(),
    )

    // ---- 2. Switch to the Radio tab and assert the live readout. ---------
    const radioTab = screen.getByRole("tab", { name: /^radio$/i })
    await user.click(radioTab)
    await waitFor(() =>
      expect(radioTab).toHaveAttribute("aria-selected", "true"),
    )

    // EU 868 readout — wait for `useRadio` to resolve.
    const readout = await screen.findByTestId("radio-readout")
    await waitFor(() => {
      expect(readout.textContent).toMatch(/869\.525\s*MHz/)
    })
    expect(readout.textContent).toMatch(/BW\s*250/)
    expect(readout.textContent).toMatch(/SF\s*11/)
    expect(readout.textContent).toMatch(/CR\s*4\/5/)

    // ---- 3. Switch region to US (auto-selects the sole US 915 preset). ---
    await user.click(screen.getByTestId("region-picker-trigger"))
    const usItem = await screen.findByTestId("region-item-US")
    await user.click(usItem)
    await waitFor(() => {
      expect(screen.getByTestId("radio-readout").textContent).toMatch(
        /910\.525\s*MHz/,
      )
    })

    // ---- 4. Apply opens the typed-confirm dialog. ------------------------
    const applyBtn = screen.getByTestId("radio-apply-btn")
    expect(applyBtn).not.toBeDisabled()
    await user.click(applyBtn)

    const confirmInput = await screen.findByTestId("radio-apply-confirm-input")
    const confirmBtn = screen.getByTestId("radio-apply-confirm-btn")
    expect(confirmBtn).toBeDisabled()

    // ---- 5. Typing APPLY enables the action; clicking it POSTs the body --
    await user.type(confirmInput, "APPLY")
    expect(confirmBtn).not.toBeDisabled()
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/device/radio",
        expect.objectContaining({
          freq: 910.525,
          bw: 250,
          sf: 11,
          cr: 5,
        }),
      )
    })

    // ---- 6. Switch to Behaviour tab; IdentityCard shows the device name --
    const behaviourTab = screen.getByRole("tab", { name: /^behaviour$/i })
    await user.click(behaviourTab)
    await waitFor(() =>
      expect(behaviourTab).toHaveAttribute("aria-selected", "true"),
    )

    // IdentityCard renders the name in its display element (mounted after
    // self-info resolves, which it has by this point).
    const nameDisplay = await screen.findByTestId("identity-name-display")
    expect(nameDisplay).toHaveTextContent("Test-Node")
  })
})
