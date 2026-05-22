/**
 * RxTuningCard — Task 4.5
 *
 * Allows editing the low-level RX timing parameters (rx_delay,
 * airtime_factor). These affect how the companion firmware schedules
 * receive windows; they are advanced parameters that most users should
 * leave at their defaults.
 *
 * Usage:
 *   <RxTuningCard />
 */
import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useTuning, useSetTuning } from "./radioQueries"
import type { TuningParams } from "./types"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RxTuningCard() {
  const { data, isLoading } = useTuning()
  const setTuning = useSetTuning()

  const [form, setForm] = useState<TuningParams>({ rx_delay: 0, airtime_factor: 0 })

  // Seed form from query data once loaded (or when it refreshes)
  useEffect(() => {
    if (data) {
      setForm({ rx_delay: data.rx_delay, airtime_factor: data.airtime_factor })
    }
  }, [data])

  const onApply = () => {
    setTuning.mutate(form)
  }

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <CardTitle className="text-base">RX Tuning</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="rx-delay"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  RX delay
                </Label>
                <Input
                  id="rx-delay"
                  aria-label="RX delay"
                  type="number"
                  min={0}
                  step={1}
                  value={form.rx_delay}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      rx_delay: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  disabled={setTuning.isPending}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="airtime-factor"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Airtime factor
                </Label>
                <Input
                  id="airtime-factor"
                  aria-label="Airtime factor"
                  type="number"
                  min={0}
                  step={1}
                  value={form.airtime_factor}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      airtime_factor: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  disabled={setTuning.isPending}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Advanced parameters. See MeshCore docs before changing.
            </p>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={onApply}
                disabled={setTuning.isPending}
              >
                {setTuning.isPending ? "Applying…" : "Apply"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
