import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Hoisted mock state so the vi.mock factories can reference it.
const mocks = vi.hoisted(() => ({
  shareMutate: vi.fn(),
  selfInfoData: undefined as
    | { public_key?: string; adv_lat?: number | null; adv_lon?: number | null }
    | undefined,
  contactsData: {} as Record<
    string,
    { public_key?: string; adv_name?: string; type?: number }
  >,
  toastError: vi.fn(),
}))

vi.mock("@/features/contacts/queries", () => ({
  useShareContact: () => ({
    mutate: mocks.shareMutate,
    isPending: false,
  }),
  useContacts: () => ({ data: mocks.contactsData, isLoading: false }),
}))

vi.mock("@/features/device/queries", () => ({
  useSelfInfo: () => ({ data: mocks.selfInfoData }),
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}))

// The Leaflet-backed map dialog is unrelated to the unit-level Sheet
// behaviour here and pulls in the full react-leaflet stack. Replace it
// with a tiny stub exposing a button that triggers `onConfirm` with
// fixed coords — that gives us deterministic coverage of the "Share
// location on map" insertion path without the Leaflet ceremony.
vi.mock("../ShareLocationMapDialog", () => ({
  ShareLocationMapDialog: ({
    open,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean
    onConfirm: (lat: number, lon: number) => void
    onOpenChange: (next: boolean) => void
  }) =>
    open ? (
      <div data-testid="map-dialog-stub">
        <button
          type="button"
          onClick={() => {
            onConfirm(50.12345, 14.54321)
            onOpenChange(false)
          }}
        >
          confirm-map
        </button>
      </div>
    ) : null,
}))

import { AttachmentMenu } from "../AttachmentMenu"
import { formatLocationSnippet } from "../locationSnippet"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  mocks.shareMutate.mockReset()
  mocks.toastError.mockReset()
  mocks.selfInfoData = {
    public_key: "ab".repeat(32),
    adv_lat: 47.5,
    adv_lon: 19.05,
  }
  mocks.contactsData = {
    ["cd".repeat(32)]: {
      public_key: "cd".repeat(32),
      adv_name: "Bravo",
      type: 1,
    },
    ["ef".repeat(32)]: {
      public_key: "ef".repeat(32),
      adv_name: "Charlie",
      type: 1,
    },
  }
})

describe("formatLocationSnippet", () => {
  it("emits the 5dp lat/lon line and an OSM URL", () => {
    const out = formatLocationSnippet(47.49790123, 19.04020456)
    expect(out).toContain("📍 47.49790, 19.04020")
    expect(out).toContain(
      "https://www.openstreetmap.org/?mlat=47.49790123&mlon=19.04020456",
    )
    expect(out).toContain("#map=15/47.49790/19.04020")
  })
})

describe("AttachmentMenu — My contact info", () => {
  it("calls useShareContact with own pubkey and inserts the URI", async () => {
    const onInsert = vi.fn()
    const uri = "meshcore://contact/add?name=Me&public_key=abcd&type=1"
    mocks.shareMutate.mockImplementation((_args, opts) => {
      opts.onSuccess({ uri })
      opts.onSettled?.()
    })

    render(wrap(<AttachmentMenu onInsert={onInsert} />))
    await userEvent.click(screen.getByLabelText(/attach/i))
    await userEvent.click(screen.getByText(/my contact info/i))

    expect(mocks.shareMutate).toHaveBeenCalledWith(
      { pubkey: "ab".repeat(32) },
      expect.any(Object),
    )
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(uri))
  })

  it("shows a toast and skips share when own pubkey is missing", async () => {
    mocks.selfInfoData = undefined
    const onInsert = vi.fn()

    render(wrap(<AttachmentMenu onInsert={vi.fn()} />))
    await userEvent.click(screen.getByLabelText(/attach/i))
    await userEvent.click(screen.getByText(/my contact info/i))

    expect(mocks.shareMutate).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
    expect(onInsert).not.toHaveBeenCalled()
  })
})

describe("AttachmentMenu — My current position", () => {
  it("inserts an OSM snippet from navigator.geolocation", async () => {
    const onInsert = vi.fn()
    const getCurrentPosition = vi.fn(
      (success: PositionCallback) =>
        success({
          coords: {
            latitude: 47.49790,
            longitude: 19.04020,
            accuracy: 5,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition),
    )
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    })

    render(wrap(<AttachmentMenu onInsert={onInsert} />))
    await userEvent.click(screen.getByLabelText(/attach/i))
    await userEvent.click(screen.getByText(/my current position/i))

    await waitFor(() => expect(onInsert).toHaveBeenCalled())
    const snippet = onInsert.mock.calls[0][0] as string
    expect(snippet).toContain("📍 47.49790, 19.04020")
    expect(snippet).toContain("mlat=47.4979")
  })
})

describe("AttachmentMenu — Share a contact", () => {
  it("opens the picker, calls share, and inserts the returned URI", async () => {
    const onInsert = vi.fn()
    const uri = "meshcore://contact/add?name=Bravo&public_key=cdcd&type=1"
    mocks.shareMutate.mockImplementation((_args, opts) => {
      opts.onSuccess({ uri })
      opts.onSettled?.()
    })

    render(wrap(<AttachmentMenu onInsert={onInsert} />))
    await userEvent.click(screen.getByLabelText(/attach/i))
    await userEvent.click(screen.getByText(/share a contact/i))

    // The picker is now visible — tap Bravo.
    await userEvent.click(screen.getByText("Bravo"))

    expect(mocks.shareMutate).toHaveBeenCalledWith(
      { pubkey: "cd".repeat(32) },
      expect.any(Object),
    )
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(uri))
  })
})

describe("AttachmentMenu — Share location on map", () => {
  it("inserts the OSM snippet returned from the map dialog", async () => {
    const onInsert = vi.fn()
    render(wrap(<AttachmentMenu onInsert={onInsert} />))

    await userEvent.click(screen.getByLabelText(/attach/i))
    await userEvent.click(screen.getByText(/share location on map/i))

    // The mocked dialog exposes a "confirm-map" button that calls
    // onConfirm with fixed coords.
    await userEvent.click(await screen.findByText("confirm-map"))

    await waitFor(() => expect(onInsert).toHaveBeenCalled())
    const snippet = onInsert.mock.calls[0][0] as string
    expect(snippet).toContain("📍 50.12345, 14.54321")
    expect(snippet).toContain("mlat=50.12345")
  })
})
