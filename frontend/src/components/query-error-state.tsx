import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface QueryErrorStateProps {
  /** Short context, e.g. "Failed to load contacts". */
  title: string
  /** The query error — message is shown when it's an Error instance. */
  error: unknown
  /** Usually the query's `refetch`. Renders a Retry button when provided. */
  onRetry?: () => void
}

/**
 * Shared error state for query failures with a Retry affordance.
 *
 * On a flaky radio link (503/504 are expected transient states) and with
 * `refetchOnWindowFocus` disabled app-wide, a bare error line leaves the
 * user no recovery path other than relaunching the PWA — always offer
 * an explicit retry.
 */
export function QueryErrorState({ title, error, onRetry }: QueryErrorStateProps) {
  return (
    <div className="space-y-3 p-4">
      <div className="text-sm text-destructive">
        {title}: {error instanceof Error ? error.message : "unknown error"}
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  )
}
