/**
 * behaviourQueries.ts — Behaviour tab mutations and queries.
 *
 * Kept separate from radioQueries.ts so each concern has a focused module.
 * All mutations follow the same pattern as radioQueries:
 *   - onSuccess → toast + specific cache invalidation
 *   - onError   → notifyError(prefix, err)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyUpdate {
  telemetry?: {
    base?: number
    loc?: number
    env?: number
  }
  manual_add_contacts?: boolean
  adv_loc_policy?: number
  multi_acks?: number
}

export interface DeviceTime {
  device_epoch: number
  server_epoch: number
  skew_s: number
}

export type CustomVars = Record<string, string | number>

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function useSetDeviceName() {
  const qc = useQueryClient()
  return useMutation<void, Error, { name: string }>({
    mutationFn: (body) => api.post("/api/device/name", body),
    onSuccess: () => {
      toast.success("Device name updated")
      qc.invalidateQueries({ queryKey: ["device", "self-info"] })
    },
    onError: (e) => notifyError("Set name", e),
  })
}

// ---------------------------------------------------------------------------
// Policy (telemetry + advert + acks)
// ---------------------------------------------------------------------------

export function useUpdatePolicy() {
  const qc = useQueryClient()
  return useMutation<void, Error, PolicyUpdate>({
    mutationFn: (body) => api.post("/api/device/policy", body),
    onSuccess: () => {
      toast.success("Policy updated")
      qc.invalidateQueries({ queryKey: ["device", "self-info"] })
    },
    onError: (e) => notifyError("Update policy", e),
  })
}

// ---------------------------------------------------------------------------
// BLE PIN
// ---------------------------------------------------------------------------

export function useSetBlePin() {
  return useMutation<void, Error, { pin: number }>({
    mutationFn: (body) => api.post("/api/device/ble-pin", body),
    onSuccess: () => {
      toast.success("BLE PIN set")
    },
    onError: (e) => notifyError("Set BLE PIN", e),
  })
}

// ---------------------------------------------------------------------------
// Custom variables
// ---------------------------------------------------------------------------

export function useCustomVars() {
  return useQuery<CustomVars>({
    queryKey: ["device", "custom-vars"],
    queryFn: () => api.get<CustomVars>("/api/device/custom-vars"),
    staleTime: 30_000,
  })
}

export function useSetCustomVar() {
  const qc = useQueryClient()
  return useMutation<void, Error, { key: string; value: string | number }>({
    mutationFn: ({ key, value }) =>
      api.put(`/api/device/custom-vars/${encodeURIComponent(key)}`, { value }),
    onSuccess: () => {
      toast.success("Custom variable saved")
      qc.invalidateQueries({ queryKey: ["device", "custom-vars"] })
    },
    onError: (e) => notifyError("Set custom var", e),
  })
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function useDeviceTime() {
  return useQuery<DeviceTime>({
    queryKey: ["device", "time"],
    queryFn: () => api.get<DeviceTime>("/api/device/time"),
    staleTime: 15_000,
  })
}

export function useSyncDeviceTime() {
  const qc = useQueryClient()
  return useMutation<void, Error, void>({
    mutationFn: () => api.post("/api/device/time/sync", {}),
    onSuccess: () => {
      toast.success("Time synced to server")
      qc.invalidateQueries({ queryKey: ["device", "time"] })
    },
    onError: (e) => notifyError("Sync time", e),
  })
}
