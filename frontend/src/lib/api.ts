import { z } from "zod"

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
  if (!headers.has("content-type") && opts.body)
    headers.set("content-type", "application/json")
  const apiKey = getApiKey()
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`)

  const res = await fetch(path, { ...opts, headers })
  if (!res.ok) {
    // Surface the backend's detail message (typically FastAPI's `detail`)
    // so error toasts everywhere in the app become actionable instead of
    // showing a bare "502 Bad Gateway". This is the single point that
    // unlocks meaningful errors for every mutation in the codebase.
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
      // ignore body read errors — we'll fall back to the status line
    }
    const msg = detail
      ? `${res.status} ${res.statusText}: ${detail}`
      : `${res.status} ${res.statusText}`
    const err = new Error(msg) as Error & { status?: number }
    err.status = res.status
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
  delete: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) =>
    request<T>(
      path,
      { method: "DELETE", body: body ? JSON.stringify(body) : undefined },
      schema,
    ),
}
