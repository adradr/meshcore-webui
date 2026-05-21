import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CONTACT_SORTS,
  loadContactSort,
  saveContactSort,
  sortContacts,
  type SortInput,
} from "../sort"

// Three contacts wired up with mixed stat coverage. Timestamps are real
// post-2020 Unix seconds so they aren't clamped by the
// MIN_PLAUSIBLE_LAST_ADVERT_S sanitization (anything pre-2020 is treated
// as a "no data" sentinel — see sort.ts).
//   alice:   last_advert=2026-05-10  msg_count=10  first=2026-01-01 last=2026-05-10
//   Bob:     last_advert=2026-05-15  msg_count=5   first=2026-03-01 last=2026-05-15
//   charlie: last_advert=null                       NO STATS (sorts to bottom)
const ALICE_LAST = 1_778_976_000 // 2026-05-10 UTC
const BOB_LAST = 1_779_408_000 //   2026-05-15 UTC
const ITEMS: SortInput[] = [
  {
    pubkey: "alice-pk",
    contact: { adv_name: "alice", last_advert: ALICE_LAST },
    stats: {
      first_msg_at: "2026-01-01T00:00:00",
      last_msg_at: "2026-05-10T00:00:00",
      msg_count: 10,
    },
  },
  {
    pubkey: "bob-pk",
    contact: { adv_name: "Bob", last_advert: BOB_LAST },
    stats: {
      first_msg_at: "2026-03-01T00:00:00",
      last_msg_at: "2026-05-15T00:00:00",
      msg_count: 5,
    },
  },
  {
    pubkey: "charlie-pk",
    contact: { adv_name: "charlie", last_advert: null },
  },
]

function order(items: SortInput[]): string[] {
  return items.map((i) => i.pubkey)
}

describe("sortContacts", () => {
  it("sorts by name case-insensitively ascending (default mode)", () => {
    expect(order(sortContacts(ITEMS, "name"))).toEqual([
      "alice-pk",
      "bob-pk",
      "charlie-pk",
    ])
  })

  it("treats missing adv_name as empty string in name mode", () => {
    const items: SortInput[] = [
      { pubkey: "no-name", contact: {} },
      { pubkey: "z", contact: { adv_name: "Zara" } },
      { pubkey: "a", contact: { adv_name: "alice" } },
    ]
    // "" sorts first; case-insensitive among the rest.
    expect(order(sortContacts(items, "name"))).toEqual(["no-name", "a", "z"])
  })

  it("sorts by last_seen (last_advert) descending; null sorts to bottom", () => {
    // bob (2026-05-15) > alice (2026-05-10) > charlie (null → no data)
    expect(order(sortContacts(ITEMS, "last_seen"))).toEqual([
      "bob-pk",
      "alice-pk",
      "charlie-pk",
    ])
  })

  it("sanitizes negative / pre-2020 last_advert as 'no data' (sorts last)", () => {
    // The radio firmware can emit:
    //  - 0 / negative for adverts received before RTC sync
    //  - small positives (seconds since boot) on never-synced devices
    //  - -1 as a "never seen" sentinel on some builds
    // All of these should sort to the bottom of last_seen rather than
    // pretending the contact was heard ~1970-01-01.
    const garbage: SortInput[] = [
      { pubkey: "real", contact: { adv_name: "real", last_advert: BOB_LAST } },
      { pubkey: "neg", contact: { adv_name: "neg", last_advert: -1 } },
      { pubkey: "zero", contact: { adv_name: "zero", last_advert: 0 } },
      { pubkey: "tiny", contact: { adv_name: "tiny", last_advert: 300 } },
      { pubkey: "null", contact: { adv_name: "null", last_advert: null } },
    ]
    const sorted = sortContacts(garbage, "last_seen")
    // 'real' must be first (the only sanitary timestamp).
    expect(sorted[0].pubkey).toBe("real")
    // All four garbage entries must follow — relative order between them
    // is unspecified (they share the NO_DATA sentinel), so just assert
    // membership of the tail.
    expect(sorted.slice(1).map((s) => s.pubkey).sort()).toEqual(
      ["neg", "null", "tiny", "zero"],
    )
  })

  it("sorts by first_seen descending; missing stats sort to bottom", () => {
    // bob (2026-03) > alice (2026-01) > charlie (none → 0)
    expect(order(sortContacts(ITEMS, "first_seen"))).toEqual([
      "bob-pk",
      "alice-pk",
      "charlie-pk",
    ])
  })

  it("sorts by last_contacted descending; missing stats sort to bottom", () => {
    // bob (2026-05-15) > alice (2026-05-10) > charlie (none → 0)
    expect(order(sortContacts(ITEMS, "last_contacted"))).toEqual([
      "bob-pk",
      "alice-pk",
      "charlie-pk",
    ])
  })

  it("puts contacts with no stats at the bottom of last_contacted", () => {
    const items: SortInput[] = [
      { pubkey: "p1", contact: { adv_name: "p1" } }, // no stats
      {
        pubkey: "p2",
        contact: { adv_name: "p2" },
        stats: {
          first_msg_at: "2026-01-01T00:00:00",
          last_msg_at: "2026-02-01T00:00:00",
          msg_count: 1,
        },
      },
    ]
    expect(order(sortContacts(items, "last_contacted"))).toEqual(["p2", "p1"])
  })

  it("sorts by most_frequent (msg_count) descending; missing → 0", () => {
    // alice (10) > bob (5) > charlie (none → 0)
    expect(order(sortContacts(ITEMS, "most_frequent"))).toEqual([
      "alice-pk",
      "bob-pk",
      "charlie-pk",
    ])
  })

  it("does not mutate the input array", () => {
    const before = order(ITEMS)
    sortContacts(ITEMS, "most_frequent")
    expect(order(ITEMS)).toEqual(before)
  })
})

describe("loadContactSort / saveContactSort", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("defaults to 'name' when nothing is stored", () => {
    expect(loadContactSort()).toBe("name")
  })

  it("round-trips a valid value via localStorage", () => {
    for (const mode of CONTACT_SORTS) {
      saveContactSort(mode)
      expect(loadContactSort()).toBe(mode)
    }
  })

  it("falls back to 'name' on a corrupted/unknown stored value", () => {
    localStorage.setItem("contacts.sort", "by_color")
    expect(loadContactSort()).toBe("name")
  })
})
