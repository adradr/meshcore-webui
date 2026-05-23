/**
 * Continuous Trace Monitor — TanStack Query hooks + Zod schemas.
 *
 * Mirrors the backend ``/api/trace/monitor/*`` surface (see
 * ``backend/app/api/trace_monitor.py``). A single sub-feature inside the
 * existing ``trace`` feature: do NOT touch the one-shot trace hooks in
 * ``../api.ts`` from here.
 *
 * The live-sample path uses the ``trace_monitor`` WS topic (matches the
 * backend broadcast name exactly — easy to typo as ``trace-monitor``). The
 * topic carries samples from ANY active session, so the handler filters by
 * ``session_id`` before patching the per-session cache.
 */
import { useCallback } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { z } from "zod"

import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"
import { useWsTopic } from "@/realtime/useWsTopic"

// ---------------------------------------------------------------------------
// Zod schemas — keep field shape aligned with backend Pydantic models in
// ``backend/app/schemas/trace_monitor.py``. ``count`` is a Pydantic
// ``@computed_field`` so it IS present in JSON output.
// ---------------------------------------------------------------------------

export const TraceHopSchema = z.object({
  hash: z.string(),
  snr: z.number(),
})

export const TraceSampleSchema = z.object({
  session_id: z.string(),
  target_pubkey: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  status: z.enum(["ok", "timeout", "unreachable", "error"]),
  path_len: z.number().nullable(),
  snr_there: z.number().nullable(),
  snr_back: z.number().nullable(),
  hops: z.array(TraceHopSchema),
  error: z.string().nullable(),
})

// The backend always emits each lifecycle field (or `null`); `.default(null)`
// keeps the inferred TS type clean as `string | null` rather than letting a
// missing field bleed `undefined` into consumers.
export const TraceStatusSchema = z.object({
  running: z.boolean(),
  session_id: z.string().nullable().default(null),
  target_pubkey: z.string().nullable().default(null),
  interval_s: z.number().nullable().default(null),
  started_at: z.string().nullable().default(null),
  samples_total: z.number().nullable().default(null),
  last_sample_at: z.string().nullable().default(null),
})

export const TraceStartResponseSchema = z.object({
  session_id: z.string(),
  target_pubkey: z.string(),
  interval_s: z.number(),
  started_at: z.string(),
})

export const TraceSamplesPageSchema = z.object({
  session_id: z.string(),
  target_pubkey: z.string(),
  count: z.number(),
  items: z.array(TraceSampleSchema),
})

export const TraceSessionSummarySchema = z.object({
  session_id: z.string(),
  target_pubkey: z.string(),
  first_sample_at: z.string(),
  last_sample_at: z.string(),
  samples_total: z.number(),
  ok_count: z.number(),
  error_count: z.number(),
})

export const TraceSessionListSchema = z.object({
  count: z.number(),
  items: z.array(TraceSessionSummarySchema),
})

// Private — shapes are trivial and no consumer needs the inferred type.
const DeleteResponseSchema = z.object({ deleted: z.number() })
const StopResponseSchema = z.object({ stopped: z.boolean() })

export type TraceHop = z.infer<typeof TraceHopSchema>
export type TraceSample = z.infer<typeof TraceSampleSchema>
export type TraceStatus = z.infer<typeof TraceStatusSchema>
export type TraceStartResponse = z.infer<typeof TraceStartResponseSchema>
export type TraceSamplesPage = z.infer<typeof TraceSamplesPageSchema>
export type TraceSessionSummary = z.infer<typeof TraceSessionSummarySchema>
export type TraceSessionList = z.infer<typeof TraceSessionListSchema>

// ---------------------------------------------------------------------------
// Cache keys — stable arrays so TanStack Query can dedupe / invalidate.
// ---------------------------------------------------------------------------

const STATUS_KEY = ["trace-monitor", "status"] as const
const samplesKey = (sid: string) =>
  ["trace-monitor", "samples", sid] as const
const sessionsKey = (pubkey: string | null) =>
  ["trace-monitor", "sessions", { pubkey }] as const

const MAX_CLIENT_BUFFER = 600

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Poll the monitor lifecycle every 5 s so other tabs / device reboots are
 * observed promptly. The endpoint is cheap (one COUNT/MAX over a small
 * table when running, otherwise just the in-memory state) so this is fine.
 */
export function useTraceMonitorStatus() {
  return useQuery<TraceStatus>({
    queryKey: STATUS_KEY,
    queryFn: () =>
      api.get<TraceStatus>("/api/trace/monitor/status", TraceStatusSchema),
    refetchInterval: 5_000,
  })
}

export interface StartTraceMonitorBody {
  pubkey: string
  interval_s: number
  force?: boolean
}

export function useStartTraceMonitor() {
  const qc = useQueryClient()
  return useMutation<TraceStartResponse, Error, StartTraceMonitorBody>({
    mutationFn: (body) =>
      api.post<TraceStartResponse>(
        "/api/trace/monitor/start",
        body,
        TraceStartResponseSchema,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STATUS_KEY })
    },
    onError: (e) => {
      notifyError("Trace monitor start", e)
    },
  })
}

export function useStopTraceMonitor() {
  const qc = useQueryClient()
  return useMutation<{ stopped: boolean }, Error, void>({
    mutationFn: () =>
      api.post<{ stopped: boolean }>(
        "/api/trace/monitor/stop",
        {},
        StopResponseSchema,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STATUS_KEY })
    },
    onError: (e) => {
      notifyError("Trace monitor stop", e)
    },
  })
}

/**
 * Seed the cache with the most-recent 500 samples for ``sessionId`` then
 * stream new ones in via the ``trace_monitor`` WS topic. The handler is
 * memoised via ``useCallback`` so ``useWsTopic`` doesn't unsubscribe /
 * re-subscribe on every render (which would create gaps in the stream).
 */
export function useTraceMonitorSamples(sessionId: string | null) {
  const qc = useQueryClient()
  const query = useQuery<TraceSample[]>({
    queryKey: samplesKey(sessionId ?? "disabled"),
    enabled: !!sessionId,
    queryFn: async () => {
      // Defensive — `enabled: !!sessionId` should prevent this, but a future
      // direct `qc.fetchQuery` call against the same key shouldn't be able
      // to produce `/api/trace/monitor/null/samples`.
      if (!sessionId) {
        throw new Error("useTraceMonitorSamples: sessionId is required")
      }
      const r = await api.get<TraceSamplesPage>(
        `/api/trace/monitor/${sessionId}/samples?limit=500`,
        TraceSamplesPageSchema,
      )
      return r.items
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const onWsSample = useCallback(
    (incoming: TraceSample) => {
      if (!sessionId || incoming.session_id !== sessionId) return
      qc.setQueryData<TraceSample[]>(samplesKey(sessionId), (prev = []) => {
        const next = [...prev, incoming]
        return next.length > MAX_CLIENT_BUFFER
          ? next.slice(-MAX_CLIENT_BUFFER)
          : next
      })
    },
    [sessionId, qc],
  )
  useWsTopic<TraceSample>("trace_monitor", onWsSample)

  return query
}

export interface UseTraceMonitorSessionsOpts {
  pubkey?: string
}

export function useTraceMonitorSessions(
  opts: UseTraceMonitorSessionsOpts = {},
) {
  const pubkey = opts.pubkey ?? null
  return useQuery<TraceSessionList>({
    queryKey: sessionsKey(pubkey),
    queryFn: () => {
      const qs = new URLSearchParams({ limit: "20" })
      if (pubkey) qs.set("pubkey", pubkey)
      return api.get<TraceSessionList>(
        `/api/trace/monitor/sessions?${qs.toString()}`,
        TraceSessionListSchema,
      )
    },
    staleTime: 5_000,
  })
}

export function useDeleteTraceMonitorSession() {
  const qc = useQueryClient()
  return useMutation<{ deleted: number }, Error, string>({
    mutationFn: (sessionId) =>
      api.delete<{ deleted: number }>(
        `/api/trace/monitor/sessions/${sessionId}`,
        undefined,
        DeleteResponseSchema,
      ),
    onSuccess: (_data, sessionId) => {
      qc.invalidateQueries({ queryKey: ["trace-monitor", "sessions"] })
      qc.invalidateQueries({ queryKey: samplesKey(sessionId) })
    },
    onError: (e) => {
      notifyError("Trace monitor delete", e)
    },
  })
}
