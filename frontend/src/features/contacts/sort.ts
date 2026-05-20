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
 * Sort key extractor for each mode. Returns a numeric value suitable for
 * descending sort (higher = "more recent" / "more frequent"). The "name"
 * mode is handled separately because it sorts strings ascending.
 *
 * Fallback strategy when a stat is missing:
 * - last_seen: fall back to 0 (push to bottom of recency sort)
 * - first_seen / last_contacted: fall back to 0 (push to bottom)
 * - most_frequent: msg_count defaults to 0
 */
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
        // last_advert is Unix seconds; normalize to ms for consistency.
        return (i.contact.last_advert ?? 0) * 1000
      case "first_seen":
        return i.stats?.first_msg_at ? Date.parse(i.stats.first_msg_at) : 0
      case "last_contacted":
        return i.stats?.last_msg_at ? Date.parse(i.stats.last_msg_at) : 0
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
