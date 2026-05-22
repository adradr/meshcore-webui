import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"
import type { RadioConfig, RadioReadout, TuningParams } from "./types"

export function useRadio() {
  return useQuery<RadioReadout>({
    queryKey: ["device", "radio"],
    queryFn: () => api.get<RadioReadout>("/api/device/radio"),
    staleTime: 30_000,
  })
}

export function useSetRadio() {
  const qc = useQueryClient()
  return useMutation<{ reconnected: boolean }, Error, RadioConfig>({
    mutationFn: (body) =>
      api.post<{ reconnected: boolean }>("/api/device/radio", body),
    onSuccess: () => {
      toast.success("Radio configured")
      // Reboot/reconnect path may invalidate self-info too — remove both
      // queries so the next mount shows a loading skeleton, not stale data.
      qc.removeQueries({ queryKey: ["device", "radio"] })
      qc.removeQueries({ queryKey: ["device", "self-info"] })
      qc.invalidateQueries({ queryKey: ["device"] })
    },
    onError: (e) => notifyError("Radio", e),
  })
}

export function useSetTxPower() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (dbm) => api.post("/api/device/tx-power", { dbm }),
    onSuccess: () => {
      toast.success("TX power updated")
      qc.invalidateQueries({ queryKey: ["device"] })
    },
    onError: (e) => notifyError("TX power", e),
  })
}

export function useTuning() {
  return useQuery<TuningParams>({
    queryKey: ["device", "tuning"],
    queryFn: () => api.get<TuningParams>("/api/device/tuning"),
    staleTime: 60_000,
  })
}

export function useSetTuning() {
  const qc = useQueryClient()
  return useMutation<void, Error, TuningParams>({
    mutationFn: (body) => api.post("/api/device/tuning", body),
    onSuccess: () => {
      toast.success("RX tuning updated")
      qc.invalidateQueries({ queryKey: ["device", "tuning"] })
    },
    onError: (e) => notifyError("Tuning", e),
  })
}
