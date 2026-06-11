// frontend/src/haptics/HapticProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useWebHaptics } from "web-haptics/react"
import { haptic as iosHaptic } from "ios-haptics"
import type { HapticHandle } from "./types"

export const HAPTIC_STORAGE_KEY = "meshcore.haptics.enabled"

/**
 * Whether the browser exposes the Web Vibration API (`navigator.vibrate`).
 * Android Chrome / Edge / Firefox say yes; iOS Safari (any version) says no.
 * Evaluated at provider-build time (not module load) so tests can stub
 * navigator per case with `vi.stubGlobal`.
 */
function isVibrateSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator).vibrate === "function"
  )
}

// Module-scope reference to the current provider handle so non-React
// modules (e.g. lib/notify.ts) can fire haptics without using the hook.
// Set/cleared by the provider's mount effect — at most one HapticProvider
// is mounted at a time (see main.tsx), so this is single-writer by design.
let _globalHandle: HapticHandle | null = null

// eslint-disable-next-line react-refresh/only-export-components
export function getGlobalHaptic(): HapticHandle | null {
  return _globalHandle
}

function loadInitialEnabled(): boolean {
  if (typeof window === "undefined") return true
  const raw = window.localStorage.getItem(HAPTIC_STORAGE_KEY)
  if (raw === null) return true
  return raw !== "false"
}

const Ctx = createContext<HapticHandle | null>(null)

export function HapticProvider({ children }: { children: ReactNode }) {
  const { trigger } = useWebHaptics()
  const [enabled, setEnabledState] = useState<boolean>(loadInitialEnabled)

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HAPTIC_STORAGE_KEY, String(v))
    }
  }, [])

  const handle: HapticHandle = useMemo<HapticHandle>(() => {
    const gate = (fn: () => void) => () => {
      if (!enabled) return
      fn()
    }
    // Route to the platform-appropriate backend:
    //
    //   Android (navigator.vibrate present): rich `web-haptics` patterns
    //     with millisecond durations + named presets.
    //
    //   iOS Safari/PWA (no navigator.vibrate): the `ios-haptics` checkbox-
    //     switch trick — supports single / double / triple tap only. Works
    //     on iOS 17.4–26.4; silently no-ops on iOS 26.5+ (Apple patched
    //     the programmatic-click path in May 2026) and on any version
    //     below 17.4 (the switch HTML attribute didn't exist).
    //
    //   Neither (older browsers, server-side): everything no-ops.
    if (isVibrateSupported()) {
      return {
        tap: gate(() => { void trigger(15) }),
        select: gate(() => { void trigger(25) }),
        success: gate(() => { void trigger("success") }),
        warn: gate(() => { void trigger([60, 40, 60]) }),
        error: gate(() => { void trigger("error") }),
        nudge: gate(() => { void trigger("nudge") }),
        enabled,
        setEnabled,
      }
    }
    // iOS path. `ios-haptics` only exposes three distinct sensations
    // (single / double / triple click on the hidden switch); map the six
    // semantic methods down by intent — subtle confirmations collapse to
    // single, success collapses to double, warn/error to triple.
    return {
      tap: gate(() => { iosHaptic() }),
      select: gate(() => { iosHaptic() }),
      success: gate(() => { iosHaptic.confirm() }),
      warn: gate(() => { iosHaptic.error() }),
      error: gate(() => { iosHaptic.error() }),
      nudge: gate(() => { iosHaptic.confirm() }),
      enabled,
      setEnabled,
    }
  }, [trigger, enabled, setEnabled])

  // Expose the live handle to non-React callers (lib/notify.ts) for as
  // long as this provider is mounted.
  useEffect(() => {
    _globalHandle = handle
    return () => {
      if (_globalHandle === handle) _globalHandle = null
    }
  }, [handle])

  return <Ctx.Provider value={handle}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHaptic(): HapticHandle {
  const v = useContext(Ctx)
  if (!v) {
    // Allow components outside the provider tree (tests, storybook) to use
    // the hook without crashing — return a silent stub.
    return {
      tap: () => {}, select: () => {}, success: () => {},
      warn: () => {}, error: () => {}, nudge: () => {},
      enabled: false, setEnabled: () => {},
    }
  }
  return v
}
