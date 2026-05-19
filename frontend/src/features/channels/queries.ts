import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"

// Device-shaped channel as returned by meshcore lib (hex-encoded bytes for
// hash/secret). Use looseObject so unknown fields from the device pass through.
const ChannelSchema = z.looseObject({
  channel_idx: z.number(),
  channel_name: z.string().optional(),
  channel_hash: z.string().optional(),
  channel_secret: z.string().optional(),
})

const ChannelList = z.array(ChannelSchema)

export type Channel = z.infer<typeof ChannelSchema>

// DB-only input shape used by POST/DELETE (those endpoints don't push to the
// device in v1.1 — see backend channels.py for the comment).
export interface ChannelInput {
  idx: number
  name: string
  psk?: string | null
}

export function useChannels() {
  return useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get("/api/channels", ChannelList),
    staleTime: 60_000,
  })
}

export function useAddChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ChannelInput) => api.post("/api/channels", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  })
}

export function useRemoveChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (idx: number) => api.delete(`/api/channels/${idx}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  })
}
