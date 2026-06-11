/**
 * Web Push subscription helpers.
 *
 * iOS Safari 16.4+ only supports Web Push when the page is added to the
 * Home Screen (i.e. running in standalone display mode).
 */

import { api } from "@/lib/api"
import { takePendingResubscribe } from "@/sw/pendingResubscribe"

/** Message type the SW posts on `pushsubscriptionchange`. */
export const PUSH_RESUBSCRIBE_MSG = "PUSH_RESUBSCRIBE" as const

/** Message type the SW posts on `notificationclick` to request an in-app navigation. */
export const PUSH_NAVIGATE_MSG = "PUSH_NAVIGATE" as const

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia("(display-mode: standalone)").matches) return true
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

export function canUsePush(): boolean {
  if (typeof window === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  if (!("PushManager" in window)) return false
  if (!("Notification" in window)) return false
  // iOS requires standalone (installed PWA) to permit push
  if (isIos() && !isStandalone()) return false
  return true
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.ready
  if (!reg) throw new Error("Service worker not ready")
  return reg
}

/**
 * Resolve the VAPID public key.
 *
 * Two sources, in order:
 *   1. `VITE_VAPID_PUBLIC_KEY` baked in at build time (requires the
 *      `--build-arg VITE_VAPID_PUBLIC_KEY=…` flag when building the image).
 *   2. The runtime endpoint `GET /api/push/vapid-public-key`, which derives
 *      the public key from the private key the backend already loaded.
 *
 * The runtime fallback means a stock `docker compose build` (no env wiring)
 * still produces a working push setup — the backend is the single source of
 * truth for the keypair.
 */
async function resolveVapidPublicKey(apiKey?: string): Promise<string> {
  const baked = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (baked) return baked
  // Send the bearer token if we have one — the endpoint sits behind the same
  // APIKeyMiddleware as the rest of /api/*, so an unauthenticated fetch from
  // behind a proxy with auth enabled would 401 and break push enable.
  const headers: Record<string, string> = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const res = await fetch("/api/push/vapid-public-key", { headers })
  if (!res.ok) {
    throw new Error(
      `VAPID public key unavailable: backend returned ${res.status}. ` +
        (res.status === 401
          ? "Set your API key in Settings first."
          : "Ensure the backend has VAPID_PRIVATE_KEY_PATH configured."),
    )
  }
  const body = (await res.json()) as { key?: string }
  if (!body.key) throw new Error("VAPID public key endpoint returned empty body")
  return body.key
}

/**
 * Compare an existing subscription's `applicationServerKey` bytes with the
 * VAPID public key we are about to subscribe under. A mismatch means the
 * server keypair was rotated (or the baked build-time key drifted from the
 * backend's actual key) — pushes signed with the new key would be rejected
 * by the push service with 403, never 410, so no self-healing happens.
 */
export function applicationServerKeyMatches(
  existing: ArrayBuffer | null | undefined,
  vapidPublicKey: string,
): boolean {
  if (!existing) return false
  const a = new Uint8Array(existing)
  const b = urlBase64ToUint8Array(vapidPublicKey)
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export async function subscribeToPush(
  apiKey?: string,
): Promise<PushSubscription> {
  if (!canUsePush()) throw new Error("Push not supported in this context")

  const vapid = await resolveVapidPublicKey(apiKey)

  const perm = await Notification.requestPermission()
  if (perm !== "granted") throw new Error(`Notification permission ${perm}`)

  const reg = await getRegistration()
  let sub = await reg.pushManager.getSubscription()
  // A subscription created under a *different* VAPID key is useless: the
  // backend's signed pushes get 403'd by the push service. Drop it and
  // re-subscribe under the current key (standard key-rotation pattern).
  if (sub && !applicationServerKeyMatches(sub.options.applicationServerKey, vapid)) {
    await sub.unsubscribe().catch(() => {})
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid)
        .buffer as ArrayBuffer,
    })
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers,
    body: JSON.stringify(sub.toJSON()),
  })
  if (!res.ok) {
    throw new Error(`subscribe failed: ${res.status}`)
  }
  return sub
}

/**
 * Wire up the page side of the SW-bridged resubscribe flow.
 *
 * Two responsibilities:
 *   1. Listen for `PUSH_RESUBSCRIBE` postMessages from the SW (fired when
 *      the user agent rotates the push endpoint) and POST the new
 *      subscription to `/api/push/resubscribe` with the bearer token
 *      attached by `api.post`.
 *   2. On mount, drain any payload the SW stashed in IndexedDB while no
 *      client was open. The next mounted page picks it up.
 *
 * Returns a teardown function so tests / hot-reload can detach the
 * listener cleanly.
 */
export function installResubscribeBridge(): () => void {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    navigator.serviceWorker == null
  ) {
    return () => {}
  }
  const handler = (event: MessageEvent): void => {
    const data = event.data as
      | { type?: string; payload?: unknown; url?: string }
      | null
    if (!data) return
    if (data.type === PUSH_NAVIGATE_MSG) {
      // Notification click: navigate client-side so the SPA isn't reloaded
      // (a hard `client.navigate()` would drop the WS, query cache and any
      // draft input). react-router's BrowserRouter listens to popstate, so
      // pushState + a synthetic popstate performs an in-app route change.
      if (typeof data.url === "string") {
        navigateInPage(data.url)
      }
      return
    }
    if (data.type !== PUSH_RESUBSCRIBE_MSG) return
    // Fire-and-forget — the SW already considers the event handled. If the
    // call fails (e.g. 401 because the user logged out), the next rotation
    // will retry. We deliberately don't surface a toast here.
    void api.post("/api/push/resubscribe", data.payload).catch((err) => {
      console.error("[push] resubscribe POST failed", err)
    })
  }
  navigator.serviceWorker.addEventListener("message", handler)
  void replayPendingResubscribe()
  return () => {
    navigator.serviceWorker.removeEventListener("message", handler)
  }
}

/** Soft client-side navigation; falls back to a hard load if pushState fails. */
function navigateInPage(url: string): void {
  try {
    const target = new URL(url, window.location.origin)
    if (target.origin !== window.location.origin) return
    const path = target.pathname + target.search + target.hash
    window.history.pushState(null, "", path)
    window.dispatchEvent(new PopStateEvent("popstate"))
  } catch {
    window.location.assign(url)
  }
}

async function replayPendingResubscribe(): Promise<void> {
  try {
    const pending = await takePendingResubscribe()
    if (pending == null) return
    await api.post("/api/push/resubscribe", pending)
  } catch (err) {
    console.error("[push] replay pending resubscribe failed", err)
  }
}

export async function unsubscribeFromPush(apiKey?: string): Promise<boolean> {
  const reg = await getRegistration()
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return false

  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  // Backend route is `DELETE /api/push/subscribe` (backend/app/api/push.py).
  // If the server-side delete fails we still unsubscribe locally, but log it:
  // a silently-kept row keeps fanning out pushes to a dead endpoint.
  try {
    const res = await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
    if (!res.ok) {
      console.error(`[push] server unsubscribe failed: ${res.status}`)
    }
  } catch (err) {
    console.error("[push] server unsubscribe failed", err)
  }

  return sub.unsubscribe()
}
