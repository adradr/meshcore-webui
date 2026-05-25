import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, setApiKey } from "@/lib/api"
import { AuthInfoSchema, type AuthInfo } from "./types"

export const AUTH_QUERY_KEY = ["auth", "info"] as const

export function useAuthInfo() {
  return useQuery<AuthInfo>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => api.get("/api/auth/info", AuthInfoSchema),
    // The login gate gets stuck if a stale 200 keeps it from re-checking.
    // 30s is short enough that a key rotation takes effect quickly without
    // hammering the endpoint.
    staleTime: 30_000,
  })
}

/** Save a new API key and refetch /api/auth/info. Returns a fn the
 * caller can `await` to know whether the new key authenticated. */
export function useSetApiKey() {
  const qc = useQueryClient()
  return async (newKey: string): Promise<AuthInfo> => {
    // Canonical setter writes localStorage AND dispatches `apikeychange`
    // so the WS provider reconnects with the new token immediately.
    setApiKey(newKey.trim() === "" ? null : newKey)
    // Force a fresh fetch with the new key.
    await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
    const data = await qc.fetchQuery({
      queryKey: AUTH_QUERY_KEY,
      queryFn: () => api.get("/api/auth/info", AuthInfoSchema),
    })
    return data
  }
}
