/**
 * RadioReadout — big Geist Mono readout block showing frequency, BW/SF/CR,
 * and derived airtime / data-rate / sensitivity metrics.
 */
import { airtimeMs, dataRateBps, sensitivityDbm } from "../loraMath"
import type { RadioConfig } from "../types"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RadioReadoutProps {
  config: RadioConfig
}

export function RadioReadout({ config }: RadioReadoutProps) {
  const airtime = airtimeMs(100, config)
  const dr = dataRateBps(config)
  const sens = sensitivityDbm(config)

  const airtimeStr =
    airtime >= 1000
      ? `${(airtime / 1000).toFixed(2)} s`
      : `${Math.round(airtime)} ms`
  const drStr = dr >= 1000
    ? `${(dr / 1000).toFixed(2)} kbps`
    : `${Math.round(dr)} bps`
  const sensStr = `${Math.round(sens)} dBm`

  return (
    <div className="space-y-1">
      {/* Primary readout */}
      <p data-testid="radio-readout" className="font-mono text-2xl tracking-tight">
        {config.freq} MHz&nbsp;
        <span className="text-muted-foreground">·</span>
        &nbsp;BW {config.bw} kHz&nbsp;
        <span className="text-muted-foreground">·</span>
        &nbsp;SF {config.sf}&nbsp;
        <span className="text-muted-foreground">·</span>
        &nbsp;CR 4/{config.cr}
      </p>
      {/* Derived metrics */}
      <p data-testid="radio-metrics" className="font-mono text-sm text-muted-foreground">
        airtime/100B&nbsp;{airtimeStr}&nbsp;
        <span aria-hidden>·</span>
        &nbsp;data rate&nbsp;{drStr}&nbsp;
        <span aria-hidden>·</span>
        &nbsp;{sensStr}
      </p>
    </div>
  )
}
