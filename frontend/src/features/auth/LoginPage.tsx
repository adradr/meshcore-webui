import { useState } from "react"
import { useSetApiKey } from "./api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { useHaptic } from "@/haptics/HapticProvider"

export function LoginPage() {
  const setApiKey = useSetApiKey()
  const haptic = useHaptic()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    setError(null)
    setPending(true)
    try {
      const info = await setApiKey(value)
      if (!info.valid) {
        setError("API key didn't authenticate — try again.")
      } else {
        haptic.success()
      }
      // On valid=true the AuthGate above us re-renders; nothing else to do.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand header mirrors the top-bar wordmark used elsewhere in the
            app, but blown up and centered for this single-purpose page. */}
        <div className="flex flex-col items-center gap-3">
          <img
            src="/icons/pwa-192x192.png"
            alt=""
            aria-hidden="true"
            className="h-16 w-16 rounded-2xl shadow-sm"
          />
          <h1 className="text-2xl font-semibold tracking-[0.2em]">MESHCORE</h1>
        </div>

        <Card>
          <CardHeader>
            <p className="text-sm text-muted-foreground">
              This server requires an API key. Paste it below to continue.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
              className="space-y-3"
            >
              <div className="space-y-1">
                <Label htmlFor="api-key">API key</Label>
                <Input
                  id="api-key"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={pending}
                  placeholder="API key"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={pending || value.trim() === ""}
                className="w-full"
              >
                {pending ? "Checking…" : "Save & continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
