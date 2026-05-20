import { useState } from "react"
import { useSetApiKey } from "./api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function LoginPage() {
  const setApiKey = useSetApiKey()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const info = await setApiKey(value)
      if (!info.valid) {
        setError("API key didn't authenticate — try again.")
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
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>MeshCore WebUI</CardTitle>
          <p className="text-sm text-muted-foreground">
            This server requires an API key. Paste it below to continue.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
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
                placeholder="Paste the bearer token from your server's .env"
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
  )
}
