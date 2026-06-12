/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching"
import { clientsClaim } from "workbox-core"
import { resolveTargetUrl } from "./resolveTargetUrl"
import { stashPendingResubscribe } from "./pendingResubscribe"
import {
  buildResubscribePayload,
  type PushResubscribePayload,
} from "./resubscribePayload"

export type { PushResubscribePayload }

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
  // With a per-sender/per-channel `tag`, a second message would silently
  // *replace* the first notification on platforms that honor tags
  // (Chrome/Android) — `renotify` keeps the sound/vibration on each update.
  // TS lib.dom omits `renotify`, hence the cast. iOS ignores it.
  if (payload.tag) {
    ;(options as NotificationOptions & { renotify?: boolean }).renotify = true
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
      // Prefer a focused/visible client so a click lands in the window the
      // user is actually looking at when several are open.
      const sameOrigin = allClients.filter(
        (c) => new URL(c.url).origin === self.location.origin,
      )
      const client =
        sameOrigin.find((c) => c.focused) ??
        sameOrigin.find((c) => c.visibilityState === "visible") ??
        sameOrigin[0]
      if (client) {
        await client.focus()
        // Ask the page to route client-side instead of `client.navigate()`:
        // a hard navigation reloads the SPA (WS reconnect, query cache and
        // draft input lost), and iOS standalone has rejected
        // WindowClient.navigate in some versions. The page-side handler
        // lives in `installResubscribeBridge` (src/pwa/push.ts).
        client.postMessage({ type: PUSH_NAVIGATE_MSG, url: targetUrl })
        return
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

export const PUSH_RESUBSCRIBE_MSG = "PUSH_RESUBSCRIBE" as const
export const PUSH_NAVIGATE_MSG = "PUSH_NAVIGATE" as const

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
        const payload = buildResubscribePayload(oldSub, newSub)
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
