import { toast } from "sonner"
import { isApiError, type ApiError } from "@/lib/api"

// A user-facing toast should answer "what happened, what now?" — not echo
// HTTP status codes, hex pubkeys, or timeout figures. Those go to
// console.debug for the developer / power-user inspecting devtools.

export interface NotifyOptions {
  /** Extra debug context logged alongside the raw error (e.g. mutation vars). */
  context?: Record<string, unknown>
}

const TIMEOUT_PATTERNS = [
  /no reply from/i,
  /timed? out/i,
  /timeout/i,
  /unreachable/i,
]

function isTimeoutLike(detail: string): boolean {
  return TIMEOUT_PATTERNS.some((re) => re.test(detail))
}

/**
 * Translate any error into a short, action-oriented toast string.
 * `prefix` describes the user action ("Path discover", "Send", etc.) — keep
 * it imperative and capitalized; the suffix follows naturally.
 */
export function friendlyMessage(prefix: string, err: unknown): string {
  if (!isApiError(err)) {
    // Network failure (no response) or non-API throw.
    if (err instanceof TypeError) return `${prefix} failed — offline?`
    return `${prefix} failed`
  }
  const status = err.status ?? 0
  const detail = err.detail ?? ""

  if (status === 401) return "API key missing or invalid — check Settings"
  if (status === 403) return "Not allowed"
  if (status === 404) return `${prefix} failed — not found`
  if (status === 409) return detail || `${prefix} conflicted`
  if (status === 422) return detail || `${prefix} rejected by device`
  if (status === 503) return "Mesh device disconnected"
  if (status === 504 || isTimeoutLike(detail))
    return `${prefix} failed — peer didn't reply`
  if (status >= 500) return `${prefix} failed — device error`
  if (status >= 400 && detail) return `${prefix} failed — ${detail}`
  return `${prefix} failed`
}

/**
 * Surface an error as a friendly toast and log the technical details to the
 * console for debugging. Designed for tanstack-query `onError` handlers and
 * mutation `catch` blocks.
 */
export function notifyError(
  prefix: string,
  err: unknown,
  opts: NotifyOptions = {},
): void {
  const friendly = friendlyMessage(prefix, err)
  toast.error(friendly)
  const raw = (err as ApiError | Error | undefined) ?? null
  console.debug("[notify]", {
    prefix,
    friendly,
    status: (raw as ApiError | null)?.status,
    detail: (raw as ApiError | null)?.detail,
    message: raw?.message,
    ...(opts.context ?? {}),
  })
}
