import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { ReactNode } from "react"

const triggerSpy = vi.fn()
vi.mock("web-haptics/react", () => ({
  useWebHaptics: () => ({ trigger: triggerSpy }),
}))

const iosSpies = {
  single: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
}
vi.mock("ios-haptics", () => {
  const haptic = Object.assign(() => iosSpies.single(), {
    confirm: () => iosSpies.confirm(),
    error: () => iosSpies.error(),
  })
  return { haptic }
})

import {
  HapticProvider,
  useHaptic,
  getGlobalHaptic,
  HAPTIC_STORAGE_KEY,
} from "../HapticProvider"

function wrap({ children }: { children: ReactNode }) {
  return <HapticProvider>{children}</HapticProvider>
}

/**
 * Make `navigator.vibrate` look defined (jsdom doesn't ship the property)
 * so the provider routes through web-haptics. Tests that want the iOS
 * fallback path delete the property explicitly.
 */
function defineVibrate() {
  Object.defineProperty(navigator, "vibrate", {
    value: () => true,
    configurable: true,
  })
}
function deleteVibrate() {
  Object.defineProperty(navigator, "vibrate", {
    value: undefined,
    configurable: true,
  })
}

describe("useHaptic (Android / web-haptics path)", () => {
  beforeEach(() => {
    triggerSpy.mockClear()
    iosSpies.single.mockClear()
    iosSpies.confirm.mockClear()
    iosSpies.error.mockClear()
    localStorage.removeItem(HAPTIC_STORAGE_KEY)
    defineVibrate()
  })
  afterEach(() => {
    deleteVibrate()
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

  it("getGlobalHaptic returns the live handle while the provider is mounted and null after unmount", () => {
    expect(getGlobalHaptic()).toBeNull()
    const { unmount, result } = renderHook(() => useHaptic(), { wrapper: wrap })
    expect(getGlobalHaptic()).not.toBeNull()
    // Calling via the global handle hits the same `trigger` underneath.
    act(() => getGlobalHaptic()?.success())
    expect(triggerSpy).toHaveBeenCalledTimes(1)
    // Sanity — hook-returned handle and global handle agree.
    expect(getGlobalHaptic()?.enabled).toBe(result.current.enabled)
    unmount()
    expect(getGlobalHaptic()).toBeNull()
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

describe("useHaptic (iOS / ios-haptics fallback path)", () => {
  beforeEach(() => {
    triggerSpy.mockClear()
    iosSpies.single.mockClear()
    iosSpies.confirm.mockClear()
    iosSpies.error.mockClear()
    localStorage.removeItem(HAPTIC_STORAGE_KEY)
    deleteVibrate()
  })

  it("routes to ios-haptics when navigator.vibrate is unavailable", () => {
    const { result } = renderHook(() => useHaptic(), { wrapper: wrap })
    act(() => result.current.tap())
    act(() => result.current.select())
    act(() => result.current.nudge())
    act(() => result.current.success())
    act(() => result.current.warn())
    act(() => result.current.error())
    // Mapping: tap/select → single; success/nudge → confirm; warn/error → error
    expect(iosSpies.single).toHaveBeenCalledTimes(2)
    expect(iosSpies.confirm).toHaveBeenCalledTimes(2)
    expect(iosSpies.error).toHaveBeenCalledTimes(2)
    // web-haptics path was NOT taken
    expect(triggerSpy).not.toHaveBeenCalled()
  })

  it("still honours the user-disable toggle on the iOS path", () => {
    localStorage.setItem(HAPTIC_STORAGE_KEY, "false")
    const { result } = renderHook(() => useHaptic(), { wrapper: wrap })
    act(() => result.current.tap())
    act(() => result.current.success())
    act(() => result.current.error())
    expect(iosSpies.single).not.toHaveBeenCalled()
    expect(iosSpies.confirm).not.toHaveBeenCalled()
    expect(iosSpies.error).not.toHaveBeenCalled()
  })
})
