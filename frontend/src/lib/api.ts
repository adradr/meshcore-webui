import { z } from "zod"

export interface ApiError extends Error {
  status?: number
  statusText?: string
  detail?: string
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && "status" in e
}

function getApiKey(): string | null {
  if (typeof localStorage === "undefined") return null
  return localStorage.getItem("apiKey")
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers = new Headers(opts.headers)
  // For FormData bodies, the browser must set `content-type: multipart/form-data;
  // boundary=...` itself — setting it manually would strip the boundary and the
  // request would 422 at the server. Only default to JSON for non-FormData bodies.
  if (
    !headers.has("content-type") &&
    opts.body &&
    !(opts.body instanceof FormData)
  )
    headers.set("content-type", "application/json")
  const apiKey = getApiKey()
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`)

  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    let detail = ""
    try {
      const body = await res.text()
      if (body) {
        try {
          const parsed = JSON.parse(body) as { detail?: unknown }
          detail =
            typeof parsed.detail === "string"
              ? parsed.detail
              : body.slice(0, 200)
        } catch {
          detail = body.slice(0, 200)
        }
      }
    } catch {
      // ignore
    }
    // `message` keeps the full technical string for logs / fallbacks; the
    // structured `status` and `detail` fields let `notifyError` produce a
    // short user-friendly toast without re-parsing the message.
    const msg = detail
      ? `${res.status} ${res.statusText}: ${detail}`
      : `${res.status} ${res.statusText}`
    const err = new Error(msg) as ApiError
    err.status = res.status
    err.detail = detail
    err.statusText = res.statusText
    throw err
  }
  if (res.status === 204) return undefined as T

  const json = await res.json()
  return schema ? schema.parse(json) : (json as T)
}

export const api = {
  get: <T>(path: string, schema?: z.ZodType<T>) =>
    request<T>(path, {}, schema),
  post: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
    request<T>(
      path,
      { method: "POST", body: JSON.stringify(body) },
      schema,
    ),
  patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
    request<T>(
      path,
      { method: "PATCH", body: JSON.stringify(body) },
      schema,
    ),
  put: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
    request<T>(
      path,
      { method: "PUT", body: JSON.stringify(body) },
      schema,
    ),
  delete: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) =>
    request<T>(
      path,
      { method: "DELETE", body: body ? JSON.stringify(body) : undefined },
      schema,
    ),
  upload: <T>(path: string, formData: FormData, schema?: z.ZodType<T>) =>
    request<T>(path, { method: "POST", body: formData }, schema),
}
