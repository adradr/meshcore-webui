import { describe, expect, it } from "vitest"
import { serialiseCsv, serialiseJson, RX_LOG_CSV_COLUMNS } from "../api"

describe("serialiseCsv", () => {
  it("emits header even when rows empty", () => {
    const csv = serialiseCsv([])
    expect(csv).toBe(RX_LOG_CSV_COLUMNS.join(","))
  })

  it("emits header + one row per entry in the canonical column order", () => {
    const csv = serialiseCsv([
      {
        recv_time: 100,
        snr: 1.5,
        rssi: -90,
        payload_length: 5,
        route_typename: "F",
        payload_typename: "TXT_PLAIN",
        pkt_hash: "aabbccdd",
        path: "",
        raw_hex: "00 01 02 03 04",
      } as never,
    ])
    const lines = csv.split("\n")
    expect(lines[0]).toBe(
      "recv_time,snr,rssi,payload_length,route_typename,payload_typename,pkt_hash,path,raw_hex",
    )
    expect(lines[1]).toBe("100,1.5,-90,5,F,TXT_PLAIN,aabbccdd,,00 01 02 03 04")
  })

  it("escapes commas, quotes, and newlines per CSV rules", () => {
    const csv = serialiseCsv([
      { pkt_hash: "ab,cd", raw_hex: 'with "quote"' } as never,
    ])
    const lines = csv.split("\n")
    expect(lines[1]).toContain('"ab,cd"')
    expect(lines[1]).toContain('"with ""quote"""')
  })

  it("renders null/undefined as empty string", () => {
    const csv = serialiseCsv([
      { recv_time: null, snr: undefined, pkt_hash: "aa" } as never,
    ])
    const cells = csv.split("\n")[1].split(",")
    expect(cells[0]).toBe("") // recv_time null
    expect(cells[1]).toBe("") // snr undefined
    expect(cells[6]).toBe("aa")
  })
})

describe("serialiseJson", () => {
  it("emits pretty-printed JSON of the array", () => {
    const json = serialiseJson([{ pkt_hash: "aa", snr: 1.0 } as never])
    const parsed = JSON.parse(json)
    expect(parsed).toEqual([{ pkt_hash: "aa", snr: 1.0 }])
    expect(json).toContain("\n") // pretty-printed
  })
})
