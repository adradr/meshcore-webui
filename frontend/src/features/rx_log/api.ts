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

  useWsTopic<RxEntry>("rx_log", (entry) => {
    if (opts.paused) return
    qc.setQueryData<RxEntry[]>(RX_LOG_KEY, (prev = []) => {
      const next = [...prev, entry]
      return next.length > MAX_CLIENT_BUFFER
        ? next.slice(-MAX_CLIENT_BUFFER)
        : next
    })
  })

  return query
}
