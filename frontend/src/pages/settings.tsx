import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BellOff } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"
import { PWAInstallPrompt } from "@/pwa/PWAInstallPrompt"
import { canUsePush, subscribeToPush, unsubscribeFromPush } from "@/pwa/push"
import { useMutes, useToggleMute } from "@/features/mutes/queries"
import {
  usePushMode,
  useSetPushMode,
  type PushMode,
} from "@/features/push/queries"
import { useContacts } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"

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
          <h2 className="mb-2 text-sm font-semibold">
            Push notification filter
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Master switch applied to every push. Per-conversation mutes below
            only matter when this is set to "All messages".
          </p>
          <PushModeRadio />
        </section>

        <Separator />

        <section>
          <h2 className="mb-2 text-sm font-semibold">Muted conversations</h2>
          <MutedList />
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

/**
 * Read-only list of currently muted conversations with a per-row unmute
 * button. Resolves contact/channel names from the existing caches when
 * possible — falls back to the raw key so an orphan mute is still visible
 * and removable.
 */
function MutedList() {
  const { data, isLoading } = useMutes()
  const { data: contacts } = useContacts()
  const { data: channels } = useChannels()
  const toggle = useToggleMute()

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground">Loading…</p>
    )
  }
  const items = data?.items ?? []
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing muted. Open a contact or channel and tap the bell icon to
        silence its push notifications.
      </p>
    )
  }

  function nameFor(kind: "contact" | "channel", key: string): string {
    if (kind === "channel") {
      const idx = Number(key)
      const ch = channels?.find((c) => c.channel_idx === idx)
      return ch?.channel_name ?? `Channel ${key}`
    }
    // Match by full-pubkey prefix.
    const entry = contacts
      ? Object.entries(contacts).find(([pk]) =>
          pk.toLowerCase().startsWith(key.toLowerCase()),
        )
      : undefined
    return entry?.[1]?.adv_name ?? key
  }

  return (
    <ul className="space-y-1">
      {items.map((m) => (
        <li
          key={`${m.kind}:${m.key}`}
          className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {nameFor(m.kind, m.key)}
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.kind}
              </span>
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(
                { kind: m.kind, key: m.key, muted: false },
                {
                  onSuccess: () => toast.success("Unmuted"),
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Failed"),
                },
              )
            }
          >
            Unmute
          </Button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Global push-mode picker (all / mentions / mute).
 *
 * Server-wide setting — applies to every subscribed device. Per-conversation
 * mutes (the section below) layer ON TOP of this and only take effect when
 * mode is "all".
 */
function PushModeRadio() {
  const pushMode = usePushMode()
  const setPushMode = useSetPushMode()
  const current: PushMode = pushMode.data?.mode ?? "all"
  const disabled = pushMode.isLoading || setPushMode.isPending

  const onChange = (v: string) => {
    setPushMode.mutate(v as PushMode, {
      onSuccess: () => toast.success("Push filter saved"),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Failed"),
    })
  }

  return (
    <RadioGroup
      value={current}
      onValueChange={onChange}
      className="gap-3"
      disabled={disabled}
    >
      <div className="flex items-start gap-2">
        <RadioGroupItem value="all" id="push-mode-all" className="mt-0.5" />
        <div className="grid gap-0.5">
          <Label htmlFor="push-mode-all">All messages</Label>
          <p className="text-xs text-muted-foreground">
            Default — push for every inbound message (subject to per-conversation
            mutes).
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <RadioGroupItem
          value="mentions"
          id="push-mode-mentions"
          className="mt-0.5"
        />
        <div className="grid gap-0.5">
          <Label htmlFor="push-mode-mentions">@-mentions only</Label>
          <p className="text-xs text-muted-foreground">
            Push only when your device name appears in a channel message. DMs
            always push.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <RadioGroupItem value="mute" id="push-mode-mute" className="mt-0.5" />
        <div className="grid gap-0.5">
          <Label htmlFor="push-mode-mute">Mute all</Label>
          <p className="text-xs text-muted-foreground">
            Global silence. Overrides per-conversation settings.
          </p>
        </div>
      </div>
    </RadioGroup>
  )
}
