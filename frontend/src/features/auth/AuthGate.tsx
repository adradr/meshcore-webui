import { useAuthInfo } from "./api"
import { LoginPage } from "./LoginPage"

interface Props {
  children: React.ReactNode
}

export function AuthGate({ children }: Props) {
  const { data, isLoading, isError } = useAuthInfo()

  // During the very first fetch we don't know if we need a login screen.
  // Render nothing (no flash) — the query resolves in milliseconds. If we
  // rendered children eagerly we'd briefly show the app, then snap to the
  // login screen, which is a worse UX than a blank frame.
  if (isLoading) return null

  // Network failure / non-2xx on /api/auth/info itself: degrade gracefully
  // by showing the children (no gate). The middleware will 401 individual
  // calls if a key is actually required — the existing notifyError mapping
  // ("API key missing or invalid — check Settings") handles that.
  if (isError || !data) return <>{children}</>

  if (data.required && !data.valid) {
    return <LoginPage />
  }
  return <>{children}</>
}
