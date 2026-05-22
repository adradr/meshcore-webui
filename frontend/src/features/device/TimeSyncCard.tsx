/**
 * TimeSyncCard — display device/server time and skew, allow sync.
 *
 * Usage:
 *   <TimeSyncCard />
 */
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDeviceTime, useSyncDeviceTime } from "./behaviourQueries"

function formatEpoch(epoch: number): string {
  return new Date(epoch * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC")
}

function skewLabel(skew: number): string {
  if (skew === 0) return "In sync"
  if (skew > 0) return `+${skew} s (device ahead of server)`
  return `${skew} s (device behind server)`
}

export function TimeSyncCard() {
  const { data, isLoading } = useDeviceTime()
  const syncTime = useSyncDeviceTime()
  const qc = useQueryClient()

  const onRefresh = () => {
    qc.invalidateQueries({ queryKey: ["device", "time"] })
  }

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <CardTitle className="text-base">Time sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Device time
                </span>
                <span
                  data-testid="time-device-display"
                  className="font-mono text-sm"
                >
                  {data ? formatEpoch(data.device_epoch) : "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Server time
                </span>
                <span
                  data-testid="time-server-display"
                  className="font-mono text-sm"
                >
                  {data ? formatEpoch(data.server_epoch) : "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Skew
                </span>
                <span
                  data-testid="time-skew-display"
                  className={[
                    "text-sm font-medium",
                    data && data.skew_s !== 0
                      ? "text-amber-500"
                      : "text-muted-foreground",
                  ].join(" ")}
                >
                  {data ? skewLabel(data.skew_s) : "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRefresh}
                data-testid="time-refresh-btn"
              >
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="time-sync-btn"
                onClick={() => syncTime.mutate()}
                disabled={syncTime.isPending}
              >
                {syncTime.isPending ? "Syncing…" : "Sync to server"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
