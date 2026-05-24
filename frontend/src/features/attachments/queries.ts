import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  deleteAttachment,
  listAttachments,
  purgeAttachments,
  uploadAttachment,
  uploadAttachmentWithProgress,
} from "./api"

export const ATTACHMENTS_KEY = ["attachments"] as const

/**
 * Variables accepted by the upload mutation. Callers can pass either a
 * bare `File` (legacy callsites) or `{ file, onProgress }` to opt into
 * upload-progress events. `onProgress` receives a 0–100 percentage.
 */
export type UploadAttachmentVars =
  | File
  | { file: File; onProgress?: (pct: number) => void }

export function useUploadAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UploadAttachmentVars) => {
      if (vars instanceof File) return uploadAttachment(vars)
      const { file, onProgress } = vars
      return onProgress
        ? uploadAttachmentWithProgress(file, onProgress)
        : uploadAttachment(file)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ATTACHMENTS_KEY }),
  })
}

export function useAttachments() {
  return useQuery({
    queryKey: [...ATTACHMENTS_KEY, "list"],
    queryFn: () => listAttachments({ limit: 100 }),
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => deleteAttachment(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ATTACHMENTS_KEY }),
  })
}

export function usePurgeAttachments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => purgeAttachments(),
    onSuccess: () => qc.removeQueries({ queryKey: ATTACHMENTS_KEY }),
  })
}
