export function resolveTargetUrl(raw: unknown, originBase: string): string {
  const fallback = new URL("/", originBase).toString()
  if (typeof raw !== "string" || raw.length === 0) return fallback
  try {
    const u = new URL(raw, originBase)
    if (u.protocol !== "https:" && u.protocol !== "http:") return fallback
    if (u.origin !== new URL(originBase).origin) return fallback
    return u.toString()
  } catch {
    return fallback
  }
}
