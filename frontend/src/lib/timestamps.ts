/**
 * Plausibility window for advert / last-heard timestamps reported by
 * MeshCore radios. See `frontend/src/features/contacts/sort.ts` for the
 * full rationale; in short the firmware can emit:
 *  - 0 / negative values when an advert was received before the RTC was
 *    synced (firmware starts at epoch 0 on cold boot)
 *  - small positive values (a few seconds / minutes since boot) on
 *    devices that never NTP-synced
 *  - -1 as a "never seen" sentinel on some builds
 *  - **future-dated values** when the radio's RTC drifts ahead of the
 *    host clock, which surfaces in the UI as "negative seconds ago"
 *
 * We treat all of these as "no data" so they don't render as nonsense
 * relative-time strings (e.g. "55483 days ago" or "-30s ago").
 */
export const MIN_PLAUSIBLE_LAST_ADVERT_S = 1_577_836_800 // 2020-01-01 UTC

/**
 * Clock drift between firmware and host has been seen at a few minutes
 * on freshly-booted radios; a one-hour grace window absorbs that without
 * admitting genuinely-broken timestamps days into the future.
 */
export const FUTURE_GRACE_S = 3600

/**
 * Returns ``true`` when ``v`` looks like a real wall-clock unix timestamp
 * (in seconds) we can meaningfully compare against ``nowMs``.
 */
export function isPlausibleSeconds(
  v: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (v == null || v === 0) return false
  if (v < MIN_PLAUSIBLE_LAST_ADVERT_S) return false
  if (v > Math.floor(nowMs / 1000) + FUTURE_GRACE_S) return false
  return true
}
