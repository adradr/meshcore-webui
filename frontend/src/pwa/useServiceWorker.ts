import { useEffect, useState } from "react"
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
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const haptic = useHaptic()

  const {
    needRefresh: [nr, setNr],
    offlineReady: [or, setOr],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegistered(reg) {
      if (reg) {
        // periodic update check (every hour)
        setInterval(
          () => {
            reg.update().catch(() => {})
          },
          60 * 60 * 1000,
        )
      }
    },
    onRegisterError(err) {
      console.error("[pwa] SW register error", err)
    },
  })

  useEffect(() => {
    setNeedRefresh(nr)
    // Nudge the user when an update is available so the prompt isn't
    // missed in their peripheral vision. Fire on the rising edge only.
    if (nr) haptic.select()
  }, [nr, haptic])

  useEffect(() => {
    setOfflineReady(or)
  }, [or])

  // Wire the SW-bridged resubscribe flow once per app mount. The SW posts
  // `PUSH_RESUBSCRIBE` messages here whenever the user agent rotates the
  // push endpoint; this page POSTs to `/api/push/resubscribe` with the
  // bearer token the SW cannot read.
  useEffect(() => {
    const teardown = installResubscribeBridge()
    return teardown
  }, [])

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker,
    close: () => {
      setNr(false)
      setOr(false)
    },
  }
}
