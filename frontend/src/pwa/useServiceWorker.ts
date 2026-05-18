import { useEffect, useState } from "react"
import { useRegisterSW } from "virtual:pwa-register/react"

export interface ServiceWorkerState {
  needRefresh: boolean
  offlineReady: boolean
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
  close: () => void
}

export function useServiceWorker(): ServiceWorkerState {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)

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
  }, [nr])

  useEffect(() => {
    setOfflineReady(or)
  }, [or])

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
