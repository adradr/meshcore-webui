/**
 * Wire-shape construction for the SW-bridged `/api/push/resubscribe` call.
 *
 * Kept out of `sw.ts` so it is unit-testable without pulling in the workbox
 * service-worker globals.
 */

export interface PushResubscribePayload {
  old_endpoint: string
  new: {
    endpoint: string
    keys: { p256dh: string; auth: string }
    expirationTime: number | null
  }
}

/** Minimal structural shape of a PushSubscription the builder needs. */
export interface SubscriptionLike {
  endpoint: string
  toJSON: () => {
    endpoint?: string
    expirationTime?: number | null
    keys?: { p256dh?: string; auth?: string }
  }
}

function subscriptionToPayload(
  sub: SubscriptionLike,
): PushResubscribePayload["new"] {
  // `PushSubscription.toJSON()` returns the canonical wire shape but its
  // typing is `unknown`-ish across browsers. Reproduce it explicitly so
  // the bridge boundary stays type-safe.
  const json = sub.toJSON()
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
    expirationTime: json.expirationTime ?? null,
  }
}

/**
 * Build the resubscribe payload posted to `/api/push/resubscribe`.
 *
 * The backend schema (`PushResubscribeIn`) requires `old_endpoint` to be a
 * valid URL. Chrome can fire `pushsubscriptionchange` with a *null*
 * `oldSubscription` (server-side key invalidation); sending `""` there
 * would 422 and silently break push. Fall back to the *new* endpoint —
 * the backend deletes that row (a no-op or a stale-row cleanup) and then
 * upserts the new subscription, which is exactly what we want.
 */
export function buildResubscribePayload(
  oldSub: SubscriptionLike | null | undefined,
  newSub: SubscriptionLike,
): PushResubscribePayload {
  const next = subscriptionToPayload(newSub)
  return {
    old_endpoint: oldSub?.endpoint ?? next.endpoint,
    new: next,
  }
}
