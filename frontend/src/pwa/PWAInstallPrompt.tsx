import { useInstallPrompt } from "./useInstallPrompt"
import { Button } from "@/components/ui/button"

export function PWAInstallPrompt() {
  const { canInstall, isIos, isStandalone, promptInstall } = useInstallPrompt()

  if (isStandalone) return null

  if (isIos) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
        <p className="mb-1 font-medium">Install MeshCore</p>
        <p className="text-muted-foreground">
          Tap the Share icon in Safari, then choose{" "}
          <span className="font-medium">Add to Home Screen</span>.
        </p>
      </div>
    )
  }

  if (!canInstall) return null

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-sm text-card-foreground">
      <div>
        <p className="font-medium">Install MeshCore</p>
        <p className="text-muted-foreground">
          Add to your home screen for a native-app experience.
        </p>
      </div>
      <Button size="sm" onClick={() => void promptInstall()}>
        Install
      </Button>
    </div>
  )
}
