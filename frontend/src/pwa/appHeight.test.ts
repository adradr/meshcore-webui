import { describe, it, expect, vi } from "vitest"

import { installAppHeight } from "./appHeight"

function fakeWindow(innerHeight: number) {
  const listeners: Record<string, Set<() => void>> = {}
  const setProperty = vi.fn()
  const win = {
    innerHeight,
    document: { documentElement: { style: { setProperty } } },
    visualViewport: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    addEventListener: (type: string, cb: () => void) => {
      ;(listeners[type] ??= new Set()).add(cb)
    },
    removeEventListener: (type: string, cb: () => void) => {
      listeners[type]?.delete(cb)
    },
  }
  return {
    win: win as unknown as Window,
    setProperty,
    fire: (type: string) => listeners[type]?.forEach((cb) => cb()),
  }
}

describe("installAppHeight", () => {
  it("pins --app-h to innerHeight px immediately", () => {
    const { win, setProperty } = fakeWindow(812)
    installAppHeight(win)
    expect(setProperty).toHaveBeenCalledWith("--app-h", "812px")
  })

  it("re-measures on resize / orientationchange", () => {
    const { win, setProperty, fire } = fakeWindow(812)
    installAppHeight(win)
    ;(win as { innerHeight: number }).innerHeight = 640
    fire("resize")
    expect(setProperty).toHaveBeenLastCalledWith("--app-h", "640px")
    ;(win as { innerHeight: number }).innerHeight = 375
    fire("orientationchange")
    expect(setProperty).toHaveBeenLastCalledWith("--app-h", "375px")
  })

  it("stops re-measuring after dispose", () => {
    const { win, setProperty, fire } = fakeWindow(812)
    const dispose = installAppHeight(win)
    dispose()
    ;(win as { innerHeight: number }).innerHeight = 500
    fire("resize")
    // only the initial apply() ran; the resize listener was detached.
    expect(setProperty).toHaveBeenCalledTimes(1)
  })
})
