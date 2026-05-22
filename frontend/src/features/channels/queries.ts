import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"
import { useDeviceInfo } from "@/features/device/queries"

// Conservative default when the device hasn't reported max_channels yet.
// Most MeshCore builds expose 8 or 16 slots; fall back to 16 so we don't
// artificially block the user.
const DEFAULT_MAX_CHANNELS = 16

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

/**
 * Resolve the device's `max_channels` capability with a safe fallback.
 *
 * The radio reports this in `mc.self_info` on some builds and only in
 * `device_info` on others; we read from `useDeviceInfo()` which is the
 * portable source. While the device link is down the hook returns
 * `undefined`, in which case we fall back to `DEFAULT_MAX_CHANNELS` so the
 * Add-Channel UI keeps working offline (the write itself still requires a
 * live radio link).
 */
export function useMaxChannels(): number {
  const { data } = useDeviceInfo()
  const v = data?.max_channels
  if (typeof v === "number" && v > 0) return v
  return DEFAULT_MAX_CHANNELS
}

/**
 * Return the lowest unused channel slot index in `[0, max_channels)`, or
 * `null` when every slot is occupied. Used by the Add-Channel flows that
 * need a free slot (Create Private, Join Private, Join Hashtag, QR-scan).
 * The Public flow always targets `idx=0` and does NOT consult this hook.
 */
export function useNextFreeChannelIdx(): number | null {
  const { data } = useChannels()
  const max = useMaxChannels()
  const used = new Set<number>((data ?? []).map((ch) => ch.channel_idx))
  for (let i = 0; i < max; i++) {
    if (!used.has(i)) return i
  }
  return null
}
