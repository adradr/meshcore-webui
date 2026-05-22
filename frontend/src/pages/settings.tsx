import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Monitor, Moon, Sun } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { useTheme, type Theme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { notifyError } from "@/lib/notify"
import { PWAInstallPrompt } from "@/pwa/PWAInstallPrompt"
import { canUsePush, subscribeToPush, unsubscribeFromPush } from "@/pwa/push"
import { MutedList } from "@/features/mutes/MutedList"
import { PushModeRadio } from "@/features/push/PushModeRadio"
import { DangerZone } from "@/features/admin/DangerZone"

const REPO_URL = "https://github.com/adradr/meshcore-webui"

const THEME_OPTIONS: ReadonlyArray<{
  value: Theme
  label: string
  Icon: typeof Sun
}> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
]

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
      notifyError(pushOn ? "Turn off notifications" : "Turn on notifications", e)
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
          <RadioGroup
            value={theme}
            onValueChange={(v) => setTheme(v as Theme)}
            className="flex w-full max-w-xs gap-1 rounded-md border bg-muted p-1"
            aria-label="Theme"
          >
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
              <Label
                key={value}
                htmlFor={`theme-${value}`}
                aria-label={label}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
                  theme === value &&
                    "bg-background text-foreground shadow-sm",
                )}
              >
                <RadioGroupItem
                  id={`theme-${value}`}
                  value={value}
                  aria-label={label}
                  className="sr-only"
                />
                <Icon className="size-3.5" aria-hidden />
                <span>{label}</span>
              </Label>
            ))}
          </RadioGroup>
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

        <DangerZone />
      </div>
    </PageShell>
  )
}
