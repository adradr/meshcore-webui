import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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

/**
 * Returns true if the radio link is up *right now*. While the very first
 * `/api/device/status` fetch is in flight (`data === undefined`), this is
 * `undefined` so callers can distinguish "unknown" from "down".
 */
export function useRadioConnected(): boolean | undefined {
  const q = useDeviceStatus()
  return q.data === undefined ? undefined : q.data.connected
}

/**
 * Radio-info hooks gate on `useRadioConnected`. Two reasons:
 *
 * 1. Don't poll the backend with /info /self-info while the radio is known
 *    to be down — it just produces 503 noise.
 * 2. **Hide stale cached data when disconnected.** React-Query keeps the
 *    last successful `data` after a failed refetch; if we just relied on
 *    `enabled: false` the UI would happily render device info from a prior
 *    session even though the radio is currently off. That's the exact
 *    "fabricated truth" bug the Phase-1 plan calls out — `data` is
 *    overridden to `undefined` while disconnected so the UI shows the
 *    honest "—" placeholder instead of a snapshot from minutes ago.
 */
function _retryNot503(count: number, err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (status === 503 || status === 502) return false
  return count < 1
}

export function useDeviceInfo() {
  const radioConnected = useRadioConnected()
  const q = useQuery({
    queryKey: ["device", "info"],
    queryFn: () => api.get("/api/device/info", DeviceInfoSchema),
    staleTime: 30_000,
    enabled: radioConnected === true,
    retry: _retryNot503,
  })
  return { ...q, data: radioConnected === true ? q.data : undefined }
}

export function useSelfInfo() {
  const radioConnected = useRadioConnected()
  const q = useQuery({
    queryKey: ["device", "self-info"],
    queryFn: () => api.get("/api/device/self-info", SelfInfoSchema),
    staleTime: 30_000,
    enabled: radioConnected === true,
    retry: _retryNot503,
  })
  return { ...q, data: radioConnected === true ? q.data : undefined }
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

/**
 * Persist GPS coordinates to the device's flash. The firmware writes
 * them and includes the value in subsequent advertisements. We invalidate
 * the self-info cache on success so `PositionCard` shows the new value
 * without a manual reload.
 */
export function useSetPosition() {
  const qc = useQueryClient()
  return useMutation<
    { lat: number; lon: number },
    Error,
    { lat: number; lon: number }
  >({
    mutationFn: (body) => api.post("/api/device/position", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["device", "self-info"] })
      toast.success("Position saved to device")
    },
    onError: (e) => notifyError("Save position", e),
  })
}
