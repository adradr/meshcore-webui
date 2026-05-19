import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/lib/api", () => ({
  // `get` is needed because LineOfSightModal now calls useSelfInfo() to
  // auto-detect the operating frequency. Returning `{}` lets the modal fall
  // back to its EU default (868 MHz) silently.
  api: { post: vi.fn(), get: vi.fn().mockResolvedValue({}) },
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { api } from "@/lib/api"
import { LineOfSightModal } from "../LineOfSightModal"

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const fakeLosOut = {
  distance_m: 10000,
  bearing_deg: 90,
  samples: [
    {
      distance_m: 0,
      lat: 0,
      lon: 0,
      ground_m: 0,
      bulge_m: 0,
      fresnel_m: 0,
      clearance_m: 30,
    },
    {
      distance_m: 5000,
      lat: 0,
      lon: 0.04,
      ground_m: 0,
      bulge_m: 1.47,
      fresnel_m: 29.4,
      clearance_m: 28.5,
    },
    {
      distance_m: 10000,
      lat: 0,
      lon: 0.08,
      ground_m: 0,
      bulge_m: 0,
      fresnel_m: 0,
      clearance_m: 30,
    },
  ],
  verdict: "CLEAR" as const,
  min_clearance_ratio: 0.97,
}

describe("LineOfSightModal", () => {
  it("renders header with both endpoint names", () => {
    render(
      wrap(
        <LineOfSightModal
          open={true}
          onOpenChange={() => {}}
          a={{ name: "Home", lat: 0, lon: 0 }}
          b={{ name: "Repeater Alpha", lat: 0, lon: 0.08 }}
        />,
      ),
    )
    expect(screen.getByText(/Home/)).toBeInTheDocument()
    expect(screen.getByText(/Repeater Alpha/)).toBeInTheDocument()
  })

  it("shows verdict pill after successful compute", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeLosOut)
    render(
      wrap(
        <LineOfSightModal
          open={true}
          onOpenChange={() => {}}
          a={{ name: "Home", lat: 0, lon: 0 }}
          b={{ name: "Repeater Alpha", lat: 0, lon: 0.08 }}
        />,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: /compute/i }))
    await waitFor(() =>
      expect(screen.getByText("CLEAR")).toBeInTheDocument(),
    )
  })

  it("renders skeleton during pending state", async () => {
    let resolveFn: (v: typeof fakeLosOut) => void = () => {}
    ;(api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<typeof fakeLosOut>((resolve) => {
          resolveFn = resolve
        }),
    )
    render(
      wrap(
        <LineOfSightModal
          open={true}
          onOpenChange={() => {}}
          a={{ name: "Home", lat: 0, lon: 0 }}
          b={{ name: "Repeater Alpha", lat: 0, lon: 0.08 }}
        />,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: /compute/i }))
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="skeleton"]'),
      ).toBeInTheDocument(),
    )
    resolveFn(fakeLosOut)
    await waitFor(() =>
      expect(screen.getByText("CLEAR")).toBeInTheDocument(),
    )
  })
})
