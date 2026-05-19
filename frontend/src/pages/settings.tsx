import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { useTheme } from "@/components/theme-provider"
import { PWAInstallPrompt } from "@/pwa/PWAInstallPrompt"
import { canUsePush, subscribeToPush, unsubscribeFromPush } from "@/pwa/push"
import { MutedList } from "@/features/mutes/MutedList"
import { PushModeRadio } from "@/features/push/PushModeRadio"

const REPO_URL = "https://github.com/randomicon/meshcore-webui"

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
    <PageShell header={<PageHeader title="Settings" />}>
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Appearance */}
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Appearance</h3>
            <p className="text-xs text-muted-foreground">
              Dark mode follows the system by default.
            </p>
          </div>
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

        {/* Notifications — single section, but the Muted list keeps a Card */}
        {/* because it has its own scrollable inner container. */}
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Notifications</h3>
            <p className="text-xs text-muted-foreground">
              Master filter applies to every push. Per-conversation mutes layer
              on top and only matter when the filter is "All messages".
            </p>
          </div>

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

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Push filter
            </h4>
            <PushModeRadio />
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Muted conversations
            </h4>
            <Card>
              <CardContent className="p-2">
                <MutedList />
              </CardContent>
            </Card>
          </div>
        </section>
        <Separator />

        {/* Security */}
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Security</h3>
            <p className="text-xs text-muted-foreground">
              Required when the server has{" "}
              <code className="rounded bg-muted px-1 text-[11px]">
                MESHCORE_WEBUI_API_KEY
              </code>{" "}
              set. Reloading the page applies the change.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key">API key</Label>
            <div className="flex gap-2">
              <Input
                id="api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="bearer token"
                className="flex-1"
              />
              <Button onClick={saveApiKey}>Save</Button>
            </div>
          </div>
        </section>
        <Separator />

        {/* About */}
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">About</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            MeshCore WebUI —{" "}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              source on GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </PageShell>
  )
}
