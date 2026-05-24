import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  uploadAttachment,
  uploadAttachmentWithProgress,
  listAttachments,
  deleteAttachment,
  purgeAttachments,
} from "../api"

const originalFetch = globalThis.fetch

function mockJson(body: unknown, init: ResponseInit = { status: 200 }) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      ...init,
    }),
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("attachments api", () => {
  it("uploadAttachment POSTs multipart with the file field", async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockJson({
        slug: "aB3kZ9pX",
        url: "https://x/s/aB3kZ9pX",
        thumb_url: "https://x/i/aB3kZ9pX/thumb",
        mime: "image/webp",
        size_bytes: 1,
        width: 1,
        height: 1,
        original_filename: null,
        uploaded_at: "2026-05-23T00:00:00Z",
      }),
    )
    const file = new File(["dummy"], "x.jpg", { type: "image/jpeg" })
    const out = await uploadAttachment(file)
    expect(out.slug).toBe("aB3kZ9pX")

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe("/api/attachments")
    expect(init.method).toBe("POST")
    expect(init.body).toBeInstanceOf(FormData)
    // Browser must own the multipart boundary; ensure we don't force a JSON CT.
    const headers = new Headers(init.headers)
    expect(headers.get("content-type")).toBeNull()
  })

  it("listAttachments builds cursor query when limit + before are set", async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockJson({
        items: [],
        next_cursor: null,
        total_count: 0,
        total_bytes: 0,
        quota_bytes: 1,
      }),
    )
    await listAttachments({ limit: 50, before: 100 })
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ]
    expect(url).toBe("/api/attachments?limit=50&before=100")
  })

  it("listAttachments omits the query string entirely when no opts are passed", async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockJson({
        items: [],
        next_cursor: null,
        total_count: 0,
        total_bytes: 0,
        quota_bytes: 1,
      }),
    )
    await listAttachments()
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ]
    expect(url).toBe("/api/attachments")
  })

  it("deleteAttachment uses DELETE without a body", async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve(new Response(null, { status: 204 })),
    )
    await deleteAttachment("aB3kZ9pX")
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe("/api/attachments/aB3kZ9pX")
    expect(init.method).toBe("DELETE")
    expect(init.body).toBeUndefined()
  })

  it("uploadAttachmentWithProgress forwards xhr.upload.onprogress events", async () => {
    // Mock just enough of XMLHttpRequest to capture the registered
    // handlers, fire a progress event, then resolve the request with a
    // valid AttachmentOut payload.
    const responseBody = {
      slug: "aB3kZ9pX",
      url: "https://x/s/aB3kZ9pX",
      thumb_url: "https://x/i/aB3kZ9pX/thumb",
      mime: "image/webp",
      size_bytes: 1,
      width: 1,
      height: 1,
      original_filename: null,
      uploaded_at: "2026-05-23T00:00:00Z",
    }

    class FakeXHR {
      status = 0
      statusText = ""
      responseText = ""
      readonly upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
        onprogress: null,
      }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      private headers: Record<string, string> = {}
      open(_method: string, _url: string, _async: boolean) {}
      setRequestHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value
      }
      send(_body: FormData) {
        // Fire one progress tick then complete.
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 50,
          total: 100,
        } as unknown as ProgressEvent)
        this.status = 200
        this.statusText = "OK"
        this.responseText = JSON.stringify(responseBody)
        this.onload?.()
      }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXHR)
    try {
      const file = new File(["dummy"], "x.jpg", { type: "image/jpeg" })
      const onProgress = vi.fn()
      const out = await uploadAttachmentWithProgress(file, onProgress)
      expect(out.slug).toBe("aB3kZ9pX")
      expect(onProgress).toHaveBeenCalledWith(50)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("purgeAttachments POSTs the PURGE confirm body", async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      mockJson({ deleted_count: 0, freed_bytes: 0 }),
    )
    await purgeAttachments()
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe("/api/attachments/purge")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ confirm: "PURGE" })
  })
})
