import { describe, expect, it } from "vitest"

import type { TraceSample } from "../api"
import { csvFilenameFor, samplesToCsv } from "../csv"

function ok(overrides: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "11111111-1111-1111-1111-111111111111",
    target_pubkey: "a".repeat(64),
    started_at: "2026-05-24T15:56:00+00:00",
    finished_at: "2026-05-24T15:56:01+00:00",
    status: "ok",
    path_len: 1,
    snr_there: 5,
    snr_back: 6,
    hops: [{ hash: "aa", snr: 5 }],
    error: null,
    ...overrides,
  }
}

describe("samplesToCsv", () => {
  it("emits a header row and one row per sample", () => {
    const csv = samplesToCsv([ok(), ok()])
    const lines = csv.trimEnd().split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      "finished_at,started_at,status,snr_there,snr_back,path_len,hops_count,hops_json,error",
    )
  })

  it("quotes fields containing commas and escapes embedded quotes", () => {
    const csv = samplesToCsv([
      ok({
        status: "error",
        error: 'reply, "garbled"',
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
      }),
    ])
    const body = csv.trimEnd().split("\n")[1]
    // hops_json column is `[]` (no comma); error column contains both a
    // comma AND an embedded double-quote — both must round-trip.
    expect(body).toContain(`"reply, ""garbled"""`)
  })

  it("renders nulls as empty cells (not the literal 'null')", () => {
    const csv = samplesToCsv([
      ok({
        status: "timeout",
        snr_there: null,
        snr_back: null,
        path_len: null,
        hops: [],
        error: null,
      }),
    ])
    const cells = csv.trimEnd().split("\n")[1].split(",")
    expect(cells[2]).toBe("timeout")
    expect(cells[3]).toBe("") // snr_there
    expect(cells[4]).toBe("") // snr_back
    expect(cells[5]).toBe("") // path_len
    expect(cells[6]).toBe("0") // hops_count
    expect(cells[8]).toBe("") // error
  })

  it("serialises hops as a single JSON cell", () => {
    const csv = samplesToCsv([
      ok({ hops: [{ hash: "ab", snr: 5 }, { hash: "cd", snr: -3 }] }),
    ])
    const body = csv.trimEnd().split("\n")[1]
    // The hops cell will be quoted because it contains commas — strip the
    // outer quotes + unescape inner double-quotes to verify the JSON.
    expect(body).toContain(`"[{""hash"":""ab"",""snr"":5},{""hash"":""cd"",""snr"":-3}]"`)
  })

  it("ends with a single trailing newline", () => {
    const csv = samplesToCsv([ok()])
    expect(csv.endsWith("\n")).toBe(true)
    expect(csv.endsWith("\n\n")).toBe(false)
  })
})

describe("csvFilenameFor", () => {
  it("uses an 8-char pubkey prefix + UTC yyyymmdd-hhmm timestamp", () => {
    const name = csvFilenameFor("eccafe7d" + "ff".repeat(28), "2026-05-24T15:56:29Z")
    expect(name).toBe("trace-eccafe7d-20260524-1556.csv")
  })

  it("falls back to '-unknown' on a malformed timestamp", () => {
    const name = csvFilenameFor("eccafe7d" + "ff".repeat(28), "not-a-date")
    expect(name).toBe("trace-eccafe7d-unknown.csv")
  })

  it("lowercases the pubkey prefix", () => {
    const name = csvFilenameFor("ECCAFE7D" + "0".repeat(56), "2026-05-24T15:56:29Z")
    expect(name.startsWith("trace-eccafe7d-")).toBe(true)
  })
})
