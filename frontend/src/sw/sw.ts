/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching"
import { clientsClaim } from "workbox-core"
import { resolveTargetUrl } from "./resolveTargetUrl"
import { installSkipWaitingGate } from "./skipWaitingGate"

declare const self: ServiceWorkerGlobalScope

// Defer skipWaiting() until the page posts {type: "SKIP_WAITING"} after the
// user clicks the reload prompt. This avoids silently swapping the SW under
// every open tab when an update lands.
installSkipWaitingGate(self)
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
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription: PushSubscription | null
  readonly newSubscription: PushSubscription | null
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
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey ?? undefined,
        })
        await fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            old: oldSub?.toJSON() ?? null,
            new: newSub.toJSON(),
          }),
        })
      } catch (err) {
        console.error("[sw] resubscribe failed", err)
      }
    })(),
  )
}) as EventListener)
