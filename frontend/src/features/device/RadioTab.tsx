/**
 * RadioTab — instrument-panel control surface for radio configuration.
 *
 * Composed of three cards:
 *  1. RadioConfigCard  — preset selector + big readout + advanced disclosure
 *                        + typed-confirm Apply dialog
 *  2. TxPowerCard      — Slider + dBm/mW display + Apply button
 *  3. RxTuningCard     — RX delay / airtime-factor tuning
 *
 * Usage:
 *   <RadioTab />
 */
import { RadioConfigCard } from "./radio/RadioConfigCard"
import { TxPowerCard } from "./radio/TxPowerCard"
import { RxTuningCard } from "./RxTuningCard"

export function RadioTab() {
  return (
    <div className="flex flex-col gap-4">
      <RadioConfigCard />
      <TxPowerCard />
      <RxTuningCard />
    </div>
  )
}
