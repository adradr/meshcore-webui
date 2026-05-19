import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { z } from "zod"
import { api } from "@/lib/api"

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
  })
}

export function useSelfInfo() {
  return useQuery({
    queryKey: ["device", "self-info"],
    queryFn: () => api.get("/api/device/self-info", SelfInfoSchema),
    staleTime: 30_000,
  })
}

export function useSendAdvert() {
  return useMutation({
    mutationFn: (flood: boolean) =>
      api.post(`/api/device/advert?flood=${flood}`, {}),
    onSuccess: (_, flood) =>
      toast.success(flood ? "Flood advert sent" : "Advert sent"),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Advert failed"),
  })
}
