import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { SettingsPage } from "@/pages/settings"
import { ThemeProvider } from "@/components/theme-provider"

// SettingsPage pulls in feature widgets that hit network/WS. Stub them so the
// page renders in jsdom without side effects — the only surface we're testing
// here is the Appearance tri-state.
vi.mock("@/features/mutes/MutedList", () => ({
  MutedList: () => <div data-testid="muted-list" />,
}))

vi.mock("@/features/push/PushModeRadio", () => ({
  PushModeRadio: () => <div data-testid="push-mode-radio" />,
}))

vi.mock("@/features/admin/DangerZone", () => ({
  DangerZone: () => <div data-testid="danger-zone" />,
}))

vi.mock("@/pwa/PWAInstallPrompt", () => ({
  PWAInstallPrompt: () => <div data-testid="pwa-install" />,
}))

vi.mock("@/pwa/push", () => ({
  canUsePush: () => false,
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}))

function renderSettings() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
          <SettingsPage />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("SettingsPage — Appearance tri-state theme toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    // Default to a "light" system preference so the resolved class is
    // deterministic for the matchMedia assertion below.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
    document.documentElement.classList.remove("light", "dark")
  })

  it("renders three theme options (light, dark, system)", () => {
    renderSettings()
    expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /system/i })).toBeInTheDocument()
  })

  it("selecting System persists the choice and marks the radio as checked", () => {
    renderSettings()
    // Default is system → System should already be the active selection.
    const systemRadio = screen.getByRole("radio", { name: /system/i })
    expect(systemRadio).toHaveAttribute("aria-checked", "true")

    // Switch to dark, then back to system, to exercise the setter path.
    fireEvent.click(screen.getByRole("radio", { name: /dark/i }))
    expect(localStorage.getItem("vite-ui-theme")).toBe("dark")
    expect(screen.getByRole("radio", { name: /dark/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )

    fireEvent.click(screen.getByRole("radio", { name: /system/i }))
    expect(localStorage.getItem("vite-ui-theme")).toBe("system")
    expect(screen.getByRole("radio", { name: /system/i })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("selecting Light removes 'dark' class from <html>", () => {
    renderSettings()
    fireEvent.click(screen.getByRole("radio", { name: /dark/i }))
    expect(document.documentElement.classList.contains("dark")).toBe(true)

    fireEvent.click(screen.getByRole("radio", { name: /light/i }))
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.classList.contains("light")).toBe(true)
  })
})

describe("ThemeProvider — live OS preference listener", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("light", "dark")
  })

  it("re-applies the resolved class when the OS preference flips while theme is 'system'", () => {
    // Capture the registered change listener so we can fire it manually.
    let registered: ((ev: { matches: boolean }) => void) | null = null
    let currentMatches = false
    const mockMql = {
      get matches() {
        return currentMatches
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (
        _: string,
        cb: (ev: { matches: boolean }) => void,
      ) => {
        registered = cb
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
    window.matchMedia = vi
      .fn()
      .mockImplementation(() => mockMql) as unknown as typeof window.matchMedia

    render(
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <div>child</div>
      </ThemeProvider>,
    )

    // Initial state: system says light → <html> should have "light".
    expect(document.documentElement.classList.contains("light")).toBe(true)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(registered).not.toBeNull()

    // Flip the OS to dark and notify.
    act(() => {
      currentMatches = true
      registered?.({ matches: true })
    })

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.classList.contains("light")).toBe(false)
  })
})
