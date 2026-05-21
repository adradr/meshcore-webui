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

// Input shape for POST /api/channels. The backend pushes this directly
// to the radio via mc.commands.set_channel; psk is an optional hex string
// (16 bytes) — when omitted/empty the firmware auto-derives the PSK from
// sha256(name)[0:16].
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
