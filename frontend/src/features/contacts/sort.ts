import {
  FUTURE_GRACE_S,
  MIN_PLAUSIBLE_LAST_ADVERT_S,
} from "@/lib/timestamps"
import type { Contact, ContactStatsRow } from "./queries"

export const CONTACT_SORTS = [
  "name",
  "last_seen",
  "first_seen",
  "last_contacted",
  "most_frequent",
] as const
export type ContactSort = (typeof CONTACT_SORTS)[number]

export const CONTACT_SORT_LABELS: Record<ContactSort, string> = {
  name: "Name",
  last_seen: "Last seen",
  first_seen: "First seen",
  last_contacted: "Last contacted",
  most_frequent: "Most frequent",
}

export interface SortInput {
  pubkey: string
  contact: Contact
  stats?: ContactStatsRow
}

/**
 * Plausibility constants (``MIN_PLAUSIBLE_LAST_ADVERT_S`` /
 * ``FUTURE_GRACE_S``) live in ``@/lib/timestamps`` and are shared with
 * the display helpers in ``features/rx_log/format.ts`` so the sort and
 * render layers agree on what counts as "no data".
 *
 * Sort key extractor for each mode returns a numeric value suitable for
 * descending sort (higher = "more recent" / "more frequent"). The "name"
 * mode is handled separately because it sorts strings ascending.
 *
 * "No data" sentinel: ``Number.NEGATIVE_INFINITY``, which sorts to the
 * bottom in the desc comparator below. Beats `0` because 0 collides with
 * real-but-tiny timestamps and obscures the intent.
 */
const NO_DATA = Number.NEGATIVE_INFINITY

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function lastAdvertMs(v: number | null | undefined): number {
  if (v == null) return NO_DATA
  if (v < MIN_PLAUSIBLE_LAST_ADVERT_S) return NO_DATA
  if (v > nowSeconds() + FUTURE_GRACE_S) return NO_DATA
  return v * 1000
}

function isoToMs(v: string | null | undefined): number {
  if (!v) return NO_DATA
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return NO_DATA
  // first_msg_at / last_msg_at are SERVER-generated so they should be
  // sane, but defense-in-depth: a future-dated message timestamp is a
  // broken clock event somewhere and shouldn't pretend to be "newest".
  if (t > Date.now() + FUTURE_GRACE_S * 1000) return NO_DATA
  return t
}

export function sortContacts(
  items: SortInput[],
  mode: ContactSort,
): SortInput[] {
  const arr = items.slice()
  if (mode === "name") {
    arr.sort((a, b) => {
      const na = (a.contact.adv_name ?? "").toLowerCase()
      const nb = (b.contact.adv_name ?? "").toLowerCase()
      return na.localeCompare(nb)
    })
    return arr
  }
  const key = (i: SortInput): number => {
    switch (mode) {
      case "last_seen":
        return lastAdvertMs(i.contact.last_advert)
      case "first_seen":
        return isoToMs(i.stats?.first_msg_at)
      case "last_contacted":
        return isoToMs(i.stats?.last_msg_at)
      case "most_frequent":
        return i.stats?.msg_count ?? 0
    }
  }
  arr.sort((a, b) => key(b) - key(a)) // desc — newest/most-frequent first
  return arr
}

const STORAGE_KEY = "contacts.sort"

export function loadContactSort(): ContactSort {
  if (typeof localStorage === "undefined") return "name"
  const v = localStorage.getItem(STORAGE_KEY)
  return (CONTACT_SORTS as readonly string[]).includes(v ?? "")
    ? (v as ContactSort)
    : "name"
}

export function saveContactSort(mode: ContactSort): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // localStorage may be unavailable (incognito/quota) — silently skip.
  }
}
