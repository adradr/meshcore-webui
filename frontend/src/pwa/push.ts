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

export async function subscribeToPush(
  apiKey?: string,
): Promise<PushSubscription> {
  if (!canUsePush()) throw new Error("Push not supported in this context")

  const vapid = await resolveVapidPublicKey(apiKey)

  const perm = await Notification.requestPermission()
  if (perm !== "granted") throw new Error(`Notification permission ${perm}`)

  const reg = await getRegistration()
  let sub = await reg.pushManager.getSubscription()
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
    const data = event.data as { type?: string; payload?: unknown } | null
    if (!data || data.type !== PUSH_RESUBSCRIBE_MSG) return
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

  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers,
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})

  return sub.unsubscribe()
}
