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

/**
 * Upload an attachment with byte-level progress reporting. Uses
 * XMLHttpRequest because `fetch()` does not surface upload-stream
 * progress in Safari yet. Mirrors the auth/header behaviour of
 * `@/lib/api` (Bearer token from `localStorage["apiKey"]`, no header
 * when the key is missing) so server-side enforcement is identical.
 */
export function uploadAttachmentWithProgress(
  file: File,
  onProgress: (pct: number) => void,
): Promise<AttachmentOut> {
  return new Promise<AttachmentOut>((resolve, reject) => {
    const fd = new FormData()
    fd.append("file", file)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/attachments", true)

    // Match `@/lib/api`: read the key from localStorage["apiKey"] and
    // omit the header entirely when no key is present (the radio dev
    // setup runs unauthenticated).
    const apiKey =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("apiKey")
        : null
    if (apiKey) xhr.setRequestHeader("authorization", `Bearer ${apiKey}`)

    // Deliberately DO NOT set Content-Type — the browser must own the
    // multipart boundary, exactly like the fetch path.

    xhr.upload.onprogress = (evt: ProgressEvent) => {
      if (!evt.lengthComputable || evt.total <= 0) return
      const pct = Math.max(0, Math.min(100, (evt.loaded / evt.total) * 100))
      onProgress(pct)
    }

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300
      if (!ok) {
        reject(
          new Error(
            `${xhr.status} ${xhr.statusText || "Upload failed"}`,
          ),
        )
        return
      }
      try {
        const parsed = AttachmentOutSchema.parse(JSON.parse(xhr.responseText))
        resolve(parsed)
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error("Invalid upload response"),
        )
      }
    }

    xhr.onerror = () => {
      reject(
        new Error(
          `Upload network error${xhr.statusText ? `: ${xhr.statusText}` : ""}`,
        ),
      )
    }
    xhr.onabort = () => {
      reject(new Error("Upload aborted"))
    }

    xhr.send(fd)
  })
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
