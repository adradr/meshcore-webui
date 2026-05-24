import { api } from "@/lib/api"
import {
  AttachmentListOutSchema,
  AttachmentOutSchema,
  PurgeResponseSchema,
  type AttachmentListOut,
  type AttachmentOut,
  type PurgeResponse,
} from "./types"

export function uploadAttachment(file: File): Promise<AttachmentOut> {
  const fd = new FormData()
  fd.append("file", file)
  return api.upload("/api/attachments", fd, AttachmentOutSchema)
}

export function listAttachments(
  opts: { limit?: number; before?: number | null } = {},
): Promise<AttachmentListOut> {
  const params = new URLSearchParams()
  if (opts.limit) params.set("limit", String(opts.limit))
  if (opts.before != null) params.set("before", String(opts.before))
  const url = "/api/attachments" + (params.toString() ? `?${params}` : "")
  return api.get(url, AttachmentListOutSchema)
}

export function deleteAttachment(slug: string): Promise<void> {
  return api.delete(`/api/attachments/${slug}`)
}

export function purgeAttachments(): Promise<PurgeResponse> {
  return api.post(
    "/api/attachments/purge",
    { confirm: "PURGE" },
    PurgeResponseSchema,
  )
}
