/**
 * TxPowerCard — slider + dBm/mW readout + Apply for TX power.
 */
import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { useRadio, useSetTxPower } from "../radioQueries"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Module-private — exporting alongside the component trips
// react-refresh/only-export-components. Only `TxPowerCard` consumes it.
function dbmToMw(dbm: number): number {
  return Math.round(Math.pow(10, dbm / 10))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TxPowerCard() {
  const { data: readout, isLoading } = useRadio()
  const setTxPower = useSetTxPower()

  const [dbm, setDbm] = useState(0)

  // Seed from readout
  const txSeededRef = useRef(false)
  useEffect(() => {
    if (readout && !txSeededRef.current) {
      txSeededRef.current = true
      setDbm(readout.tx_power)
    }
  }, [readout])

  const maxDbm = readout?.max_tx_power ?? 22
  const mw = dbmToMw(dbm)

  const onApply = () => {
    setTxPower.mutate(dbm)
  }

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <CardTitle className="text-base">TX Power</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground">
                0
              </span>
              <Slider
                min={0}
                max={maxDbm}
                step={1}
                value={[dbm]}
                onValueChange={([v]) => setDbm(v)}
                disabled={setTxPower.isPending}
                aria-label="TX power"
                className="flex-1"
              />
              <span className="w-6 shrink-0 font-mono text-sm text-muted-foreground">
                {maxDbm}
              </span>
              {/* Live readout to the right of slider */}
              <span className="w-28 shrink-0 font-mono text-base font-medium tabular-nums">
                {dbm} dBm ({mw} mW)
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              Currently: {readout?.tx_power} dBm. Hardware ceiling: {maxDbm} dBm.
            </p>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                data-testid="tx-power-apply-btn"
                onClick={onApply}
                disabled={setTxPower.isPending}
              >
                {setTxPower.isPending ? "Applying…" : "Apply"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
