import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const setApiKeyMock = vi.fn()
vi.mock("../api", () => ({
  useAuthInfo: vi.fn(),
  useSetApiKey: () => setApiKeyMock,
  AUTH_QUERY_KEY: ["auth", "info"],
}))

import { LoginPage } from "../LoginPage"

describe("LoginPage", () => {
  beforeEach(() => {
    setApiKeyMock.mockReset()
  })

  it("disables submit when input is empty", () => {
    render(<LoginPage />)
    const btn = screen.getByRole("button", { name: /save & continue/i })
    expect(btn).toBeDisabled()
  })

  it("uses a short placeholder so the field doesn't crowd on mobile", () => {
    render(<LoginPage />)
    const input = screen.getByLabelText(/api key/i) as HTMLInputElement
    expect(input.placeholder).toBe("API key")
  })

  it("calls setApiKey with the entered value on submit", async () => {
    setApiKeyMock.mockResolvedValue({ required: true, valid: true })
    render(<LoginPage />)
    const input = screen.getByLabelText(/api key/i)
    fireEvent.change(input, { target: { value: "my-key" } })
    const btn = screen.getByRole("button", { name: /save & continue/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(setApiKeyMock).toHaveBeenCalledWith("my-key")
    })
  })

  it("shows an inline error when setApiKey returns valid=false", async () => {
    setApiKeyMock.mockResolvedValue({ required: true, valid: false })
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "bad-key" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save & continue/i }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/didn't authenticate/i)
  })

  it("disables input and shows 'Checking…' while pending", async () => {
    // Hold the promise so we can observe the pending state.
    let resolve: (v: { required: boolean; valid: boolean }) => void = () => {}
    setApiKeyMock.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res
        }),
    )
    render(<LoginPage />)
    const input = screen.getByLabelText(/api key/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: "key" } })
    const btn = screen.getByRole("button", { name: /save & continue/i })
    fireEvent.click(btn)

    // Pending state asserted.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /checking/i }),
      ).toBeInTheDocument()
    })
    expect(input).toBeDisabled()

    // Release the promise so the test doesn't dangle.
    resolve({ required: true, valid: true })
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /checking/i }),
      ).toBeNull()
    })
  })
})
