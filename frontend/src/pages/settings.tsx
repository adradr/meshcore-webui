import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"
import { PWAInstallPrompt } from "@/pwa/PWAInstallPrompt"
import { canUsePush, subscribeToPush, unsubscribeFromPush } from "@/pwa/push"

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [apiKey, setApiKey] = useState(
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("apiKey") ?? "")
      : "",
  )
  const [pushOn, setPushOn] = useState(false)
  const [pushAvailable, setPushAvailable] = useState(false)

  useEffect(() => {
    setPushAvailable(canUsePush())
    navigator.serviceWorker?.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setPushOn(!!s))
      .catch(() => {
        /* ignore */
      })
  }, [])

  const togglePush = async () => {
    try {
      // Read the LATEST stored key, not the in-memory `apiKey` state — that
      // one only updates after Save, while push toggles should respect what's
      // actually persisted (and thus what every other API call sends).
      const storedKey =
        typeof localStorage !== "undefined"
          ? (localStorage.getItem("apiKey") ?? undefined)
          : undefined
      if (pushOn) {
        await unsubscribeFromPush(storedKey)
        setPushOn(false)
        toast.success("Notifications off")
      } else {
        await subscribeToPush(storedKey)
        setPushOn(true)
        toast.success("Notifications on")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    }
  }

  const saveApiKey = () => {
    if (apiKey) localStorage.setItem("apiKey", apiKey)
    else localStorage.removeItem("apiKey")
    toast.success("API key saved — reload to apply")
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 p-4">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Appearance</h2>
          <div className="flex items-center gap-3">
            <Label htmlFor="dark">Dark mode</Label>
            <Switch
              id="dark"
              checked={theme === "dark"}
              onCheckedChange={(c) => setTheme(c ? "dark" : "light")}
            />
          </div>
        </section>

        <Separator />

        <section>
          <h2 className="mb-2 text-sm font-semibold">Notifications</h2>
          {pushAvailable ? (
            <div className="flex items-center gap-3">
              <Label htmlFor="push">Push notifications</Label>
              <Switch
                id="push"
                checked={pushOn}
                onCheckedChange={togglePush}
              />
            </div>
          ) : (
            <PWAInstallPrompt />
          )}
        </section>

        <Separator />

        <section>
          <h2 className="mb-2 text-sm font-semibold">API key (optional)</h2>
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="bearer token"
          />
          <Button className="mt-2" onClick={saveApiKey}>
            Save
          </Button>
        </section>
      </div>
    </div>
  )
}
