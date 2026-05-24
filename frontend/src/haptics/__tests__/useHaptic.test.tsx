import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { ReactNode } from "react"

const triggerSpy = vi.fn()
vi.mock("web-haptics/react", () => ({
  useWebHaptics: () => ({ trigger: triggerSpy }),
}))

import { HapticProvider, useHaptic, HAPTIC_STORAGE_KEY } from "../HapticProvider"

function wrap({ children }: { children: ReactNode }) {
  return <HapticProvider>{children}</HapticProvider>
}

describe("useHaptic", () => {
  beforeEach(() => {
    triggerSpy.mockClear()
    localStorage.removeItem(HAPTIC_STORAGE_KEY)
  })

  it("maps semantic methods to web-haptics presets", () => {
    const { result } = renderHook(() => useHaptic(), { wrapper: wrap })
    act(() => result.current.tap())
    act(() => result.current.success())
    act(() => result.current.error())
    act(() => result.current.warn())
    act(() => result.current.select())
    act(() => result.current.nudge())
    expect(triggerSpy).toHaveBeenCalledTimes(6)
    const presets = triggerSpy.mock.calls.map((c) => c[0])
    expect(presets).toContain("success")
    expect(presets).toContain("error")
    expect(presets).toContain("nudge")
  })

  it("no-ops every method when the toggle is off", () => {
    localStorage.setItem(HAPTIC_STORAGE_KEY, "false")
    const { result } = renderHook(() => useHaptic(), { wrapper: wrap })
    act(() => result.current.tap())
    act(() => result.current.success())
    act(() => result.current.error())
    expect(triggerSpy).not.toHaveBeenCalled()
  })

  it("exposes setEnabled which persists to localStorage AND gates trigger live", () => {
    const { result } = renderHook(() => useHaptic(), { wrapper: wrap })
    act(() => result.current.setEnabled(false))
    expect(localStorage.getItem(HAPTIC_STORAGE_KEY)).toBe("false")
    act(() => result.current.tap())
    expect(triggerSpy).not.toHaveBeenCalled()
    act(() => result.current.setEnabled(true))
    act(() => result.current.tap())
    expect(triggerSpy).toHaveBeenCalledTimes(1)
  })
})
