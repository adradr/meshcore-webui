import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"
import { useWsTopic } from "@/realtime/useWsTopic"

export const NoiseSampleSchema = z.object({
  noise_floor: z.number().nullable().optional(),
  last_rssi: z.number().nullable().optional(),
  last_snr: z.number().nullable().optional(),
  tx_air_secs: z.number().nullable().optional(),
  rx_air_secs: z.number().nullable().optional(),
  t_ms: z.number(),
})

export const NoiseRecentResponseSchema = z.object({
  items: z.array(NoiseSampleSchema),
  count: z.number(),
})

export type NoiseSample = z.infer<typeof NoiseSampleSchema>
export type NoiseRecentResponse = z.infer<typeof NoiseRecentResponseSchema>

const NOISE_KEY = ["noise"] as const
const MAX_CLIENT_BUFFER = 300

export function useNoiseSamples(opts: { paused?: boolean } = {}) {
  const qc = useQueryClient()
  const query = useQuery<NoiseSample[]>({
    queryKey: NOISE_KEY,
    queryFn: async () => {
      const res = await api.get<NoiseRecentResponse>(
        "/api/noise/recent?n=150",
        NoiseRecentResponseSchema,
      )
      return res.items
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })

  // Memoise the WS handler so its identity is stable across renders. Without
  // this, `useWsTopic`'s effect (which lists `handler` as a dep) would
  // unsubscribe + re-subscribe on every render, adding latency to the live
  // stream and producing brief gaps where samples can be missed.
  const handleNoiseSample = useCallback(
    (sample: NoiseSample) => {
      if (opts.paused) return
      qc.setQueryData<NoiseSample[]>(NOISE_KEY, (prev = []) => {
        const next = [...prev, sample]
        return next.length > MAX_CLIENT_BUFFER
          ? next.slice(-MAX_CLIENT_BUFFER)
          : next
      })
    },
    [opts.paused, qc],
  )
  useWsTopic<NoiseSample>("noise", handleNoiseSample)

  return query
}
