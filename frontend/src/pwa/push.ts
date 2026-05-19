/**
 * Web Push subscription helpers.
 *
 * iOS Safari 16.4+ only supports Web Push when the page is added to the
 * Home Screen (i.e. running in standalone display mode).
 */

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
