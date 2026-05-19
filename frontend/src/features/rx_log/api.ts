import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"
import { useWsTopic } from "@/realtime/useWsTopic"

export const RxEntrySchema = z.object({
  recv_time: z.number().nullable().optional(),
  snr: z.number().nullable().optional(),
  rssi: z.number().nullable().optional(),
  payload: z.string().nullable().optional(),
  payload_length: z.number().nullable().optional(),
  route_type: z.number().nullable().optional(),
  route_typename: z.string().nullable().optional(),
  payload_type: z.number().nullable().optional(),
  payload_typename: z.string().nullable().optional(),
  path_len: z.number().nullable().optional(),
  path_hash_size: z.number().nullable().optional(),
  path: z.string().nullable().optional(),
  pkt_hash: z.string().nullable().optional(),
  raw_hex: z.string().nullable().optional(),
})

export const RxLogResponseSchema = z.object({
  items: z.array(RxEntrySchema),
  total_buffered: z.number(),
  returned: z.number(),
})

export type RxEntry = z.infer<typeof RxEntrySchema>
export type RxLogResponse = z.infer<typeof RxLogResponseSchema>

const RX_LOG_KEY = ["rx-log"] as const
const MAX_CLIENT_BUFFER = 1000

export function useRxLog(opts: { paused?: boolean } = {}) {
  const qc = useQueryClient()
  const query = useQuery<RxEntry[]>({
    queryKey: RX_LOG_KEY,
    queryFn: async () => {
      const res = await api.get<RxLogResponse>(
        "/api/rx-log?limit=200",
        RxLogResponseSchema,
      )
      return res.items
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })

  // Memoise the WS handler so its identity is stable across renders. Without
  // this, `useWsTopic`'s effect (which lists `handler` as a dep) would
  // unsubscribe + re-subscribe on every render, adding latency to the live
  // stream and producing brief gaps where messages can be missed.
  const handleRxEntry = useCallback(
    (entry: RxEntry) => {
      if (opts.paused) return
      qc.setQueryData<RxEntry[]>(RX_LOG_KEY, (prev = []) => {
        const next = [...prev, entry]
        return next.length > MAX_CLIENT_BUFFER
          ? next.slice(-MAX_CLIENT_BUFFER)
          : next
      })
    },
    [opts.paused, qc],
  )
  useWsTopic<RxEntry>("rx_log", handleRxEntry)

  return query
}

export const RX_LOG_CSV_COLUMNS = [
  "recv_time",
  "snr",
  "rssi",
  "payload_length",
  "route_typename",
  "payload_typename",
  "pkt_hash",
  "path",
  "raw_hex",
] as const

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function serialiseCsv(rows: RxEntry[]): string {
  const header = RX_LOG_CSV_COLUMNS.join(",")
  const body = rows
    .map((r) =>
      RX_LOG_CSV_COLUMNS.map((c) =>
        csvEscape((r as Record<string, unknown>)[c]),
      ).join(","),
    )
    .join("\n")
  return rows.length > 0 ? `${header}\n${body}` : header
}

export function serialiseJson(rows: RxEntry[]): string {
  return JSON.stringify(rows, null, 2)
}
