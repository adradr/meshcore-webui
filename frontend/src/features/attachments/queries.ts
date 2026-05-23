import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  deleteAttachment,
  listAttachments,
  purgeAttachments,
  uploadAttachment,
} from "./api"

export const ATTACHMENTS_KEY = ["attachments"] as const

export function useUploadAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadAttachment(file),
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
