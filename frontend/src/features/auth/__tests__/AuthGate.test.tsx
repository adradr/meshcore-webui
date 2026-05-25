import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const setApiKeyMock = vi.fn()
vi.mock("../api", () => ({
  useAuthInfo: vi.fn(),
  useSetApiKey: () => setApiKeyMock,
  AUTH_QUERY_KEY: ["auth", "info"],
}))

import { useAuthInfo } from "../api"
import { AuthGate } from "../AuthGate"

const mockedUseAuthInfo = useAuthInfo as ReturnType<typeof vi.fn>

function mockAuth(state: {
  data?: { required: boolean; valid: boolean }
  isLoading?: boolean
  isError?: boolean
}) {
  mockedUseAuthInfo.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  })
}

describe("AuthGate", () => {
  beforeEach(() => {
    setApiKeyMock.mockReset()
    mockedUseAuthInfo.mockReset()
  })

  it("renders children when auth isn't required", () => {
    mockAuth({ data: { required: false, valid: true } })
    render(
      <AuthGate>
        <div data-testid="app">app</div>
      </AuthGate>,
    )
    expect(screen.getByTestId("app")).toBeInTheDocument()
  })

  it("renders children when auth is required and valid", () => {
    mockAuth({ data: { required: true, valid: true } })
    render(
      <AuthGate>
        <div data-testid="app">app</div>
      </AuthGate>,
    )
    expect(screen.getByTestId("app")).toBeInTheDocument()
  })

  it("renders LoginPage when required and not valid", () => {
    mockAuth({ data: { required: true, valid: false } })
    render(
      <AuthGate>
        <div data-testid="app">app</div>
      </AuthGate>,
    )
    // App content must NOT be visible.
    expect(screen.queryByTestId("app")).toBeNull()
    // Login UI is rendered.
    expect(
      screen.getByRole("button", { name: /save & continue/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /meshcore/i })).toBeInTheDocument()
  })

  it("renders nothing while loading (no flash)", () => {
    mockAuth({ isLoading: true })
    const { container } = render(
      <AuthGate>
        <div data-testid="app">app</div>
      </AuthGate>,
    )
    expect(screen.queryByTestId("app")).toBeNull()
    // No login UI either.
    expect(screen.queryByRole("button")).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it("does not render children when /api/auth/info errors (fail-closed)", () => {
    mockAuth({ isError: true })
    const { container } = render(
      <AuthGate>
        <div data-testid="app">app</div>
      </AuthGate>,
    )
    // Holding the UI shell while auth status is unknown avoids a brief
    // flash of the full app on a transient /api/auth/info failure (e.g.
    // captive portal) before the middleware 401s individual calls.
    expect(screen.queryByTestId("app")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it("does not render children when data is missing", () => {
    mockAuth({ data: undefined })
    const { container } = render(
      <AuthGate>
        <div data-testid="app">app</div>
      </AuthGate>,
    )
    expect(screen.queryByTestId("app")).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})
