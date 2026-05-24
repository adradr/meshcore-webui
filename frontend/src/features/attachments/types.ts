import { z } from "zod"

export const AttachmentOutSchema = z.object({
  slug: z.string(),
  url: z.string(),
  thumb_url: z.string(),
  mime: z.string(),
  size_bytes: z.number(),
  width: z.number(),
  height: z.number(),
  original_filename: z.string().nullable(),
  uploaded_at: z.string(),
})
export type AttachmentOut = z.infer<typeof AttachmentOutSchema>

export const AttachmentListOutSchema = z.object({
  items: z.array(AttachmentOutSchema),
  next_cursor: z.number().nullable(),
  total_count: z.number(),
  total_bytes: z.number(),
  quota_bytes: z.number(),
})
export type AttachmentListOut = z.infer<typeof AttachmentListOutSchema>

export const PurgeResponseSchema = z.object({
  deleted_count: z.number(),
  freed_bytes: z.number(),
})
export type PurgeResponse = z.infer<typeof PurgeResponseSchema>
