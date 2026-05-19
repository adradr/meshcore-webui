import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { z } from "zod"
import { api } from "@/lib/api"
import { useWsTopic } from "@/realtime/useWsTopic"

export const TraceHopCandidateSchema = z.object({
  name: z.string().nullable(),
  pub_key: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
})

export const TraceHopOutSchema = z.object({
  hash: z.string(),
  snr: z.number(),
  name: z.string().nullable(),
  pub_key: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  candidates: z.array(TraceHopCandidateSchema).default([]),
})

export const TraceOutSchema = z.object({
  requested_target_pubkey: z.string(),
  tag: z.number(),
  flags: z.number(),
  path_len: z.number(),
  hops: z.array(TraceHopOutSchema),
})

export type TraceHopCandidate = z.infer<typeof TraceHopCandidateSchema>
export type TraceHopOut = z.infer<typeof TraceHopOutSchema>
export type TraceOut = z.infer<typeof TraceOutSchema>

export function useTracePath() {
  return useMutation<TraceOut, Error, string>({
    mutationFn: async (pubkey: string) => {
      try {
        return await api.post<TraceOut>(
          `/api/trace/${pubkey}`,
          {},
          TraceOutSchema,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error(`Trace failed: ${msg}`)
        throw e
      }
    },
  })
}

export function useTraceEvents(onTrace: (payload: unknown) => void) {
  useWsTopic("trace", onTrace)
}
