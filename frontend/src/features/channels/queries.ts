import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"

const ChannelSchema = z.object({
  id: z.number(),
  idx: z.number(),
  name: z.string(),
  psk: z.string().nullable(),
  created_at: z.string(),
})

const ChannelList = z.array(ChannelSchema)

export type Channel = z.infer<typeof ChannelSchema>

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
    mutationFn: (input: ChannelInput) =>
      api.post("/api/channels", input, ChannelSchema),
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
