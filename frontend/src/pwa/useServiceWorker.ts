import { useEffect } from "react"
import { useRegisterSW } from "virtual:pwa-register/react"
import { useHaptic } from "@/haptics/HapticProvider"
import { installResubscribeBridge } from "./push"

export interface ServiceWorkerState {
  needRefresh: boolean
  offlineReady: boolean
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
  close: () => void
}

export function useServiceWorker(): ServiceWorkerState {
  const haptic = useHaptic()

  const {
    needRefresh: [nr, setNr],
    offlineReady: [or, setOr],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegistered(reg) {
      if (reg) {
        // Check for a new SW when the app returns to the foreground instead
        // of on a mid-session timer. The SW skipWaiting()s on install and
        // `registerType: "autoUpdate"` reloads on the resulting
        // `controllerchange`, so a timer-driven update check while the user
        // is actively using the app could reload mid-typing and drop a
        // half-composed message. Resume-time checks land updates the moment
        // the user comes back — and on iOS standalone, background timers
        // don't fire anyway. Throttled so rapid app-switching doesn't
        // hammer the server.
        let lastCheck = Date.now()
        const UPDATE_CHECK_MIN_INTERVAL_MS = 60 * 1000
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible") return
          if (Date.now() - lastCheck < UPDATE_CHECK_MIN_INTERVAL_MS) return
          lastCheck = Date.now()
          reg.update().catch(() => {})
        })
      }
    },
    onRegisterError(err) {
      console.error("[pwa] SW register error", err)
    },
  })

  // Nudge the user when an update is available so the prompt isn't
  // missed in their peripheral vision. Fire on the rising edge only.
  useEffect(() => {
    if (nr) haptic.select()
  }, [nr, haptic])

  // Wire the SW-bridged resubscribe flow once per app mount. The SW posts
  // `PUSH_RESUBSCRIBE` messages here whenever the user agent rotates the
  // push endpoint; this page POSTs to `/api/push/resubscribe` with the
  // bearer token the SW cannot read.
  useEffect(() => {
    const teardown = installResubscribeBridge()
    return teardown
  }, [])

  return {
    needRefresh: nr,
    offlineReady: or,
    updateServiceWorker,
    close: () => {
      setNr(false)
      setOr(false)
    },
  }
}
