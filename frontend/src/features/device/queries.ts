import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { z } from "zod"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

const DeviceInfoSchema = z.looseObject({
  "fw ver": z.number().optional(),
  max_contacts: z.number().optional(),
  max_channels: z.number().optional(),
  ble_pin: z.number().optional(),
  fw_build: z.string().optional(),
  model: z.string().optional(),
  ver: z.string().optional(),
  repeat: z.boolean().optional(),
})

const DeviceStatusSchema = z.object({
  connected: z.boolean(),
  host: z.string().nullable(),
  port: z.number().nullable(),
})

export type DeviceStatus = z.infer<typeof DeviceStatusSchema>

/**
 * Polled honest status of the backend's TCP companion link to the radio.
 * Distinct from the browser↔server WebSocket state — the WS can be open
 * while the radio link is down (and vice-versa). UI 'Connected' badges
 * MUST read from here, not from `useRealtime().status`.
 *
 * Side-effect-free on the backend: never raises, returns `connected:false`
 * when the radio isn't reachable.
 */
export function useDeviceStatus(options?: { refetchIntervalMs?: number }) {
  return useQuery({
    queryKey: ["device", "status"],
    queryFn: () => api.get("/api/device/status", DeviceStatusSchema),
    refetchInterval: options?.refetchIntervalMs ?? 5_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })
}

const SelfInfoSchema = z.looseObject({
  name: z.string().optional(),
  public_key: z.string().optional(),
  adv_lat: z.number().optional(),
  adv_lon: z.number().optional(),
  radio_freq: z.number().optional(),
  radio_bw: z.number().optional(),
  radio_sf: z.number().optional(),
  radio_cr: z.number().optional(),
  tx_power: z.number().optional(),
  max_tx_power: z.number().optional(),
})

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>
export type SelfInfo = z.infer<typeof SelfInfoSchema>

export function useDeviceInfo() {
  return useQuery({
    queryKey: ["device", "info"],
    queryFn: () => api.get("/api/device/info", DeviceInfoSchema),
    staleTime: 30_000,
    // Don't hammer when the radio is down — 503/502 are expected during a
    // disconnect and the toast/notify layer would spam.
    retry: (count, err) => {
      const status = (err as { status?: number } | null)?.status
      if (status === 503 || status === 502) return false
      return count < 1
    },
  })
}

export function useSelfInfo() {
  return useQuery({
    queryKey: ["device", "self-info"],
    queryFn: () => api.get("/api/device/self-info", SelfInfoSchema),
    staleTime: 30_000,
    retry: (count, err) => {
      const status = (err as { status?: number } | null)?.status
      if (status === 503 || status === 502) return false
      return count < 1
    },
  })
}

export function useSendAdvert() {
  return useMutation({
    mutationFn: (flood: boolean) =>
      api.post(`/api/device/advert?flood=${flood}`, {}),
    onSuccess: (_, flood) =>
      toast.success(flood ? "Flood advert sent" : "Advert sent"),
    onError: (e) => notifyError("Advert", e),
  })
}
