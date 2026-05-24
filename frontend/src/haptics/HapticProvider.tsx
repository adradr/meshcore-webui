// frontend/src/haptics/HapticProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useWebHaptics } from "web-haptics/react"
import type { HapticHandle } from "./types"

export const HAPTIC_STORAGE_KEY = "meshcore.haptics.enabled"

// Module-scope reference to the current provider handle so non-React
// modules (e.g. lib/notify.ts) can fire haptics without using the hook.
// Set/cleared by the provider's mount effect — at most one HapticProvider
// is mounted at a time (see main.tsx), so this is single-writer by design.
let _globalHandle: HapticHandle | null = null

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
