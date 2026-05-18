import { useEffect, useState } from "react"

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
  prompt(): Promise<void>
}

export interface InstallPromptState {
  canInstall: boolean
  isStandalone: boolean
  isIos: boolean
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia("(display-mode: standalone)").matches) return true
  // iOS Safari uses navigator.standalone
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [isStandalone, setIsStandalone] = useState(detectStandalone)
  const isIos = detectIos()

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setDeferred(null)
      setIsStandalone(true)
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onAppInstalled)

    const mql = window.matchMedia("(display-mode: standalone)")
    const onMql = () => setIsStandalone(detectStandalone())
    mql.addEventListener("change", onMql)

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onAppInstalled)
      mql.removeEventListener("change", onMql)
    }
  }, [])

  return {
    canInstall: !!deferred && !isStandalone,
    isStandalone,
    isIos,
    promptInstall: async () => {
      if (!deferred) return "unavailable"
      await deferred.prompt()
      const choice = await deferred.userChoice
      setDeferred(null)
      return choice.outcome
    },
  }
}
