import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

export interface LocalResetSelector {
  messages?: boolean
  diagnostic_runs?: boolean
  rx_log?: boolean
  mutes?: boolean
  settings?: boolean
  push_subscribers?: boolean
}

export interface DeviceResetSelector {
  channels?: boolean
  coords?: boolean
  contacts?: boolean
}

export interface ResetRequest {
  local?: LocalResetSelector
  device?: DeviceResetSelector
  confirm: string
}

export interface ResetResult {
  local: {
    messages: number | null
    diagnostic_runs: number | null
    rx_log: number | null
    mutes: number | null
    settings: number | null
    push_subscribers: number | null
  }
  device: {
    cleared_channels: number | null
    coords_reset: boolean
    removed_contacts: number | null
  }
}

/** Count how many targets reported a non-null result. */
function totalTargetsRun(r: ResetResult): number {
  const localCount = Object.values(r.local).filter((v) => v !== null).length
  const deviceCount =
    (r.device.cleared_channels !== null ? 1 : 0) +
    (r.device.coords_reset ? 1 : 0) +
    (r.device.removed_contacts !== null ? 1 : 0)
  return localCount + deviceCount
}

/**
 * Unified reset. Caller picks any combination of local + device targets.
 * Backend enforces "at least one selected" and the case-sensitive
 * confirm token. On success we invalidate every react-query cache
 * since a reset touches almost every data shape we display.
 */
export function useReset() {
  const qc = useQueryClient()
  return useMutation<ResetResult, Error, ResetRequest>({
    mutationFn: (body) => api.post<ResetResult>("/api/admin/reset", body),
    onSuccess: (r) => {
      toast.success(`Reset complete — ${totalTargetsRun(r)} target(s) cleared`)
      qc.invalidateQueries()
    },
    onError: (e) => notifyError("Reset", e),
  })
}

export interface DeviceFactoryResult {
  mode: "factory"
  warning: string
}

/**
 * Factory reset — WIPES the Ed25519 identity keypair. The device
 * reboots with a fresh keypair and every peer sees it as a new node.
 * Backend returns 202 Accepted with a warning string the UI shows.
 */
export function useDeviceFactoryReset() {
  return useMutation<DeviceFactoryResult, Error, { confirm: string }>({
    mutationFn: (body) =>
      api.post<DeviceFactoryResult>("/api/device/reset", {
        mode: "factory",
        confirm: body.confirm,
      }),
    onSuccess: () => {
      toast.success("Factory reset accepted — device is rebooting.")
    },
    onError: (e) => notifyError("Factory reset device", e),
  })
}
