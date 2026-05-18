import { useEffect, useState } from "react"

/**
 * Track the browser's online/offline state via the standard `navigator.onLine`
 * and the `online`/`offline` window events.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  )

  useEffect(() => {
    const onUp = () => setOnline(true)
    const onDown = () => setOnline(false)
    window.addEventListener("online", onUp)
    window.addEventListener("offline", onDown)
    return () => {
      window.removeEventListener("online", onUp)
      window.removeEventListener("offline", onDown)
    }
  }, [])

  return online
}
