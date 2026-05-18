import { useServiceWorker } from "./useServiceWorker"
import { Button } from "@/components/ui/button"

export function ReloadPrompt() {
  const { needRefresh, offlineReady, updateServiceWorker, close } =
    useServiceWorker()

  if (!needRefresh && !offlineReady) return null

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-background p-4 shadow-lg"
    >
      <div className="mb-2 text-sm">
        {needRefresh
          ? "New content available — reload?"
          : "App ready to work offline."}
      </div>
      <div className="flex gap-2">
        {needRefresh && (
          <Button size="sm" onClick={() => updateServiceWorker(true)}>
            Reload
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={close}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
