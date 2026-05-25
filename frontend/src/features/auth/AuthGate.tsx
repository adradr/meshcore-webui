import { useAuthInfo } from "./api"
import { LoginPage } from "./LoginPage"

interface Props {
  children: React.ReactNode
}

export function AuthGate({ children }: Props) {
  const { data, isLoading, isError } = useAuthInfo()

  // Hold the UI shell while auth status is unknown — either during the
  // initial fetch or on a transient /api/auth/info failure (network blip,
  // captive portal, 5xx). Rendering children eagerly would briefly show
  // the full app before the middleware 401s individual calls, which is
  // both a confusing UX and a small captive-portal-style attack window.
  // The query resolves in milliseconds, so a blank frame is fine.
  if (isLoading || isError || !data) return null

  if (data.required && !data.valid) {
    return <LoginPage />
  }
  return <>{children}</>
}
