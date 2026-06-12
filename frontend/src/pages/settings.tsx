import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Activity, Eye, EyeOff, Monitor, Moon, Sun } from "lucide-react"
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
import { setApiKey as persistApiKey } from "@/lib/api"
import { PWAInstallPrompt } from "@/pwa/PWAInstallPrompt"
import { canUsePush, subscribeToPush, unsubscribeFromPush } from "@/pwa/push"
import { useHaptic } from "@/haptics/HapticProvider"
import { MutedList } from "@/features/mutes/MutedList"
import { PushModeRadio } from "@/features/push/PushModeRadio"
import { NewContactNotifyToggle } from "@/features/push/NewContactNotifyToggle"
import { AttachmentsManager } from "@/features/admin/AttachmentsManager"
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
  const haptic = useHaptic()
  const [apiKey, setApiKey] = useState(
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("apiKey") ?? "")
      : "",
  )
  const [showApiKey, setShowApiKey] = useState(false)
  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  // Lazy initializer: feature detection is stable for the page lifetime.
  const [pushAvailable] = useState(() => canUsePush())

  useEffect(() => {
    navigator.serviceWorker?.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setPushOn(!!s))
      .catch(() => {
        /* ignore */
      })
  }, [])

  const togglePush = async () => {
    if (pushBusy) return
    setPushBusy(true)
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
    } finally {
      setPushBusy(false)
    }
  }

  const saveApiKey = () => {
    // Canonical setter — dispatches `apikeychange` so the WS hot-reloads
    // with the new token, no full page reload needed.
    persistApiKey(apiKey ? apiKey : null)
    toast.success("API key saved")
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

        {/* Haptics — vibration confirmations routed per-platform:
              Android Chrome/PWA → rich web-haptics patterns (richest)
              iOS 17.4–26.4 Safari/PWA → ios-haptics switch trick (3 sensations)
              iOS 26.5+ → no-op (Apple patched the trick in May 2026)
              Older browsers → no-op */}
        <section className="space-y-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" aria-hidden />
              Haptics
            </h3>
            <p className="text-xs text-muted-foreground">
              Small vibration confirmations when you send a message, copy a
              link, or receive a notification. Works on Android (full
              patterns) and iOS 17.4–26.4 (three sensations). iOS 26.5+
              currently has no programmable haptic path — Apple removed
              the workaround in May 2026.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="haptics-toggle" className="text-sm">
              Enable haptic feedback
            </Label>
            <Switch
              id="haptics-toggle"
              checked={haptic.enabled}
              onCheckedChange={(v) => {
                haptic.setEnabled(v)
                // Fire a sample tap so the user feels the change confirm.
                if (v) haptic.tap()
              }}
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
                disabled={pushBusy}
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
              New contacts
            </h4>
            <NewContactNotifyToggle />
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
              set. Saving applies the change immediately — no reload needed.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key">API key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="bearer token"
                  className="pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  aria-pressed={showApiKey}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
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

        {/* Attachments summary — links out to /attachments for the full grid.
            Keeping the list off Settings stops the attachments query from
            firing every time the user opens this page. */}
        <AttachmentsManager />

        <DangerZone />
      </div>
    </PageShell>
  )
}
