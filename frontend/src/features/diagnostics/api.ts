import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"
import {
  DiagnosticReportSchema,
  type DiagnosticReport,
  type DiagnosticRunRequest,
} from "./types"

const reportKey = (pubkey: string) =>
  ["diagnostic", pubkey, "last"] as const

export function useLinkDiagnostic(pubkey: string) {
  const qc = useQueryClient()
  return useMutation<DiagnosticReport, Error, DiagnosticRunRequest | undefined>({
    mutationFn: (body) =>
      api.post<DiagnosticReport>(
        `/api/diagnostics/${pubkey}/link`,
        body ?? {},
        DiagnosticReportSchema,
      ),
    onSuccess: (report) => {
      // Seed the "last" cache so the panel can render the just-finished
      // report without a refetch.
      qc.setQueryData(reportKey(pubkey), report)
    },
    onError: (e) => notifyError("Link diagnostic", e),
  })
}

export function useLastDiagnostic(pubkey: string | undefined) {
  return useQuery<DiagnosticReport>({
    queryKey: pubkey
      ? reportKey(pubkey)
      : (["diagnostic", "none"] as const),
    queryFn: () =>
      api.get<DiagnosticReport>(
        `/api/diagnostics/${pubkey}/last`,
        DiagnosticReportSchema,
      ),
    enabled: !!pubkey,
    // 404 is expected when no run has happened yet — don't retry it.
    retry: (failureCount, err) => {
      const status = (err as { status?: number } | null)?.status
      if (status === 404) return false
      return failureCount < 1
    },
    staleTime: 60_000,
  })
}
