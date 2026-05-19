/**
 * React Query bindings for per-conversation push-notification mute state.
 *
 * Mute state is global to this server (not per-browser): the backend gates
 * web-push fan-out, so flipping mute affects every subscribed device.
 *
 * The cache is a single `["mutes"]` query holding the full list — small by
 * design (one row per muted conversation) so we never need to paginate or
 * index it client-side.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { api } from "@/lib/api"

const MutePrefSchema = z.object({
  kind: z.enum(["contact", "channel"]),
  key: z.string(),
})

const MutesResponseSchema = z.object({ items: z.array(MutePrefSchema) })

export type MutePref = z.infer<typeof MutePrefSchema>
export type MuteKind = MutePref["kind"]

export function useMutes() {
  return useQuery({
    queryKey: ["mutes"],
    queryFn: () => api.get("/api/mutes", MutesResponseSchema),
    staleTime: 30_000,
  })
}

interface ToggleVars {
  kind: MuteKind
  key: string
  muted: boolean
}

export function useToggleMute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, key, muted }: ToggleVars) =>
      api.patch(
        `/api/mutes/${kind}/${encodeURIComponent(key)}`,
        { muted },
        MutePrefSchema,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mutes"] })
    },
  })
}

/**
 * Convenience read-side hook. Returns `false` while the list is loading so
 * we don't flash a wrong "muted" state for new conversations — the worst
 * case is a brief moment where a muted conversation shows the bell icon
 * (it'll resolve as soon as the query lands).
 */
export function useIsMuted(
  kind: MuteKind,
  key: string | undefined,
): boolean {
  const { data } = useMutes()
  if (!key) return false
  return (data?.items ?? []).some((m) => m.kind === kind && m.key === key)
}
