import { useMutation } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

export const LosPointSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  height_m: z.number(),
})

export const LosInSchema = z.object({
  a: LosPointSchema,
  b: LosPointSchema,
  freq_hz: z.number().optional(),
  samples: z.number().nullable().optional(),
})

export const LosSampleSchema = z.object({
  distance_m: z.number(),
  lat: z.number(),
  lon: z.number(),
  ground_m: z.number(),
  bulge_m: z.number(),
  fresnel_m: z.number(),
  clearance_m: z.number(),
})

export const LosOutSchema = z.object({
  distance_m: z.number(),
  bearing_deg: z.number(),
  samples: z.array(LosSampleSchema),
  verdict: z.enum(["CLEAR", "PARTIAL", "BLOCKED"]),
  min_clearance_ratio: z.number(),
})

export type LosPoint = z.infer<typeof LosPointSchema>
export type LosIn = z.infer<typeof LosInSchema>
export type LosSample = z.infer<typeof LosSampleSchema>
export type LosOut = z.infer<typeof LosOutSchema>

export function useLosCompute() {
  return useMutation<LosOut, Error, LosIn>({
    mutationFn: async (vars) => {
      try {
        return await api.post<LosOut>("/api/los/compute", vars, LosOutSchema)
      } catch (e) {
        notifyError("Line-of-sight calculation", e)
        throw e
      }
    },
  })
}
