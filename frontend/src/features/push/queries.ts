/**
 * React Query bindings for the global push-notification mode.
 *
 * Mode is server-wide (single Setting row): the backend gates the web-push
 * fan-out, so changing it affects every subscribed device immediately.
 *
 * The cache is a single ["push", "mode"] query — tiny payload, infrequent
 * change, no pagination needed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"

const PushModeSchema = z.object({
  mode: z.enum(["all", "mentions", "mute"]),
})

export type PushMode = z.infer<typeof PushModeSchema>["mode"]

export function usePushMode() {
  return useQuery({
    queryKey: ["push", "mode"],
    queryFn: () => api.get("/api/push/mode", PushModeSchema),
    staleTime: 30_000,
  })
}

export function useSetPushMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mode: PushMode) =>
      api.put("/api/push/mode", { mode }, PushModeSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["push", "mode"] })
    },
  })
}
