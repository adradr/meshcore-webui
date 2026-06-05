/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching"
import { clientsClaim } from "workbox-core"
import { resolveTargetUrl } from "./resolveTargetUrl"
import { stashPendingResubscribe } from "./pendingResubscribe"

declare const self: ServiceWorkerGlobalScope

// Auto-activate a freshly-installed SW, then take control of open clients.
// vite-plugin-pwa (`registerType: "autoUpdate"`) reloads the page on the
// resulting `controllerchange`, so a new build lands on the next launch with
// no user action.
//
// This replaces a `skipWaiting()` gate that only fired on a SKIP_WAITING
// message from the reload prompt — that prompt never surfaces on iOS
// standalone PWAs, so the waiting SW never activated and devices stayed
// pinned to stale bundles across every deploy. Auto-activation is the right
// trade-off for a self-hosted, single-origin app where the SW is served from
// the operator's own container.
self.addEventListener("install", () => {
  self.skipWaiting()
})
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// ---- Push event ----
self.addEventListener("push", (event: PushEvent) => {
  let payload: {
    title?: string
    body?: string
    icon?: string
    badge?: string
    url?: string
    tag?: string
  } = {}

  try {
    if (event.data) {
      payload = event.data.json()
    }
  } catch {
    payload = { title: "MeshCore", body: event.data?.text() ?? "New message" }
  }

  const title = payload.title ?? "MeshCore"
  const options: NotificationOptions = {
    body: payload.body ?? "",
    icon: payload.icon ?? "/icons/pwa-192x192.png",
    badge: payload.badge ?? "/icons/badge-72x72.png",
    tag: payload.tag,
    data: { url: payload.url ?? "/" },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ---- Notification click ----
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close()
  const targetUrl = resolveTargetUrl(
    event.notification.data?.url,
    self.location.origin,
  )

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const client of allClients) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin) {
          await client.focus()
          if ("navigate" in client) {
            await client.navigate(targetUrl)
          }
          return
        }
      }
      await self.clients.openWindow(targetUrl)
    })(),
  )
})

// ---- Push subscription change (re-subscribe) ----
//
// The browser fires `pushsubscriptionchange` when it rotates the push
// endpoint (Firefox after a long offline period; Chrome after server-side
// key invalidation). The SW cannot read the API bearer token from
// `localStorage`, so a direct `fetch("/api/push/resubscribe")` would 401
// against any deployment with auth enabled — that's a silent push outage.
//
// Bridge: forward the rotation to any open client via `postMessage`. The
// page (which has the bearer token) POSTs the resubscribe. If no client
// is open, stash the payload in IndexedDB; the next mounted page drains
// it. The SW never touches the API directly.
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription: PushSubscription | null
  readonly newSubscription: PushSubscription | null
}

export interface PushResubscribePayload {
  old_endpoint: string
  new: {
    endpoint: string
    keys: { p256dh: string; auth: string }
    expirationTime: number | null
  }
}

export const PUSH_RESUBSCRIBE_MSG = "PUSH_RESUBSCRIBE" as const

function subscriptionToPayload(
  sub: PushSubscription,
): PushResubscribePayload["new"] {
  // `PushSubscription.toJSON()` returns the canonical wire shape but its
  // typing is `unknown`-ish across browsers. Reproduce it explicitly so
  // the bridge boundary stays type-safe.
  const json = sub.toJSON() as {
    endpoint?: string
    expirationTime?: number | null
    keys?: { p256dh?: string; auth?: string }
  }
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
    expirationTime: json.expirationTime ?? null,
  }
}

self.addEventListener("pushsubscriptionchange", ((
  event: PushSubscriptionChangeEvent,
) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription
        const applicationServerKey =
          oldSub?.options.applicationServerKey ?? undefined
        const newSub =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey ?? undefined,
          }))
        const payload: PushResubscribePayload = {
          old_endpoint: oldSub?.endpoint ?? "",
          new: subscriptionToPayload(newSub),
        }
        const clients = await self.clients.matchAll({
          includeUncontrolled: true,
          type: "window",
        })
        if (clients.length > 0) {
          for (const c of clients) {
            c.postMessage({ type: PUSH_RESUBSCRIBE_MSG, payload })
          }
        } else {
          await stashPendingResubscribe(payload)
        }
      } catch (err) {
        console.error("[sw] resubscribe failed", err)
      }
    })(),
  )
}) as EventListener)
