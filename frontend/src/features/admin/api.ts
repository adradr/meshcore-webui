import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

export type LocalResetScope = "messages" | "all" | "push"
export type DeviceResetMode = "soft" | "factory"

export interface LocalResetResult {
  scope: LocalResetScope
  deleted_rows: number
}
export interface DeviceSoftResult {
  mode: "soft"
  cleared_channels: number
}
export interface DeviceFactoryResult {
  mode: "factory"
  warning: string
}

/**
 * Wipe local SQLite tables. Three scopes:
 *  - "messages": just chat history
 *  - "all": messages + diagnostic_runs + rx_log + mutes + settings
 *    (push_subscriptions PRESERVED so browsers don't re-enroll)
 *  - "push": push_subscriptions only
 * Invalidates ALL react-query caches on success — cheaper than
 * enumerating every key the reset might affect.
 */
export function useLocalReset() {
  const qc = useQueryClient()
  return useMutation<
    LocalResetResult,
    Error,
    { scope: LocalResetScope; confirm: string }
  >({
    mutationFn: (body) =>
      api.post<LocalResetResult>("/api/admin/reset/local", body),
    onSuccess: (r) => {
      toast.success(`Cleared ${r.deleted_rows} rows (${r.scope})`)
      qc.invalidateQueries()
    },
    onError: (e) => notifyError("Reset local data", e),
  })
}

/**
 * Soft device reset — clears non-public channels + GPS coords on the
 * radio's flash. Identity, contacts, radio params preserved.
 */
export function useDeviceSoftReset() {
  const qc = useQueryClient()
  return useMutation<DeviceSoftResult, Error, { confirm: string }>({
    mutationFn: (body) =>
      api.post<DeviceSoftResult>("/api/device/reset", {
        mode: "soft",
        confirm: body.confirm,
      }),
    onSuccess: (r) => {
      toast.success(
        `Device soft-reset — cleared ${r.cleared_channels} channels`,
      )
      // Refresh self-info / channels caches so the UI reflects the cleared state.
      qc.invalidateQueries({ queryKey: ["device"] })
      qc.invalidateQueries({ queryKey: ["channels"] })
    },
    onError: (e) => notifyError("Soft reset device", e),
  })
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
