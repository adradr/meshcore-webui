import type { RadioConfig } from "./types"

// Required SNR per spreading factor (dB) — Semtech datasheet SX127x.
const SNR_REQUIRED: Record<number, number> = {
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
}

// Noise figure for typical companion receivers — 6 dB is a reasonable
// conservative value; vendors quote 5–7 dB depending on the chip.
const NOISE_FIGURE_DB = 6

// Boltzmann thermal floor at 290 K — -174 dBm/Hz.
const THERMAL_FLOOR_DBM_HZ = -174

// MeshCore packets carry an explicit header; CRC on by default.
const HEADER_EXPLICIT = true
const CRC_ON = true

// MeshCore uses 8-symbol preambles (standard LoRa default).
const NPREAMBLE = 8

/**
 * Duration of a single LoRa symbol in milliseconds.
 * Ts = 2^SF / BW  where BW is in kHz, so the result is in ms directly.
 */
export function symbolTimeMs(cfg: Pick<RadioConfig, "sf" | "bw">): number {
  return (2 ** cfg.sf) / cfg.bw
}

/**
 * Standard rule: enable Low Data Rate Optimisation when symbol time > 16 ms.
 * Required by the LoRa specification at SF ≥ 11 with BW = 125 kHz.
 */
export function lowDataRateOptimize(cfg: Pick<RadioConfig, "sf" | "bw">): boolean {
  return symbolTimeMs(cfg) > 16
}

/**
 * On-air time in milliseconds for a packet of `payloadBytes` using the
 * Semtech LoRa airtime formula (AN1200.22 rev 1.2).
 *
 * Assumptions:
 *  - Explicit header (IH = 0 in Semtech notation)
 *  - CRC enabled
 *  - Preamble length = 8 symbols (MeshCore default)
 *  - LDR optimisation applied automatically when symbol time > 16 ms
 */
export function airtimeMs(payloadBytes: number, cfg: RadioConfig): number {
  const Ts = symbolTimeMs(cfg)
  const Tpreamble = (NPREAMBLE + 4.25) * Ts

  const PL = payloadBytes
  const SF = cfg.sf
  const CR = cfg.cr - 4   // cr field 5..8 → coding-rate index 1..4
  const H = HEADER_EXPLICIT ? 0 : 1   // 0 = explicit header in Semtech formula
  const CRC = CRC_ON ? 1 : 0
  const DE = lowDataRateOptimize(cfg) ? 1 : 0

  const numerator = 8 * PL - 4 * SF + 28 + 16 * CRC - 20 * H
  const denominator = 4 * (SF - 2 * DE)
  const NpayloadSymbols =
    8 + Math.max(0, Math.ceil(numerator / denominator) * (CR + 4))

  return Tpreamble + NpayloadSymbols * Ts
}

/**
 * Effective data rate in bits per second.
 * DR = SF * BW_Hz / 2^SF * (4 / (4 + CR_index))
 */
export function dataRateBps(cfg: Pick<RadioConfig, "sf" | "bw" | "cr">): number {
  const CR = cfg.cr - 4
  return (cfg.sf * (cfg.bw * 1000)) / (2 ** cfg.sf) * (4 / (4 + CR))
}

/**
 * Theoretical receiver sensitivity in dBm.
 * Sensitivity = ThermalFloor + 10*log10(BW_Hz) + NF + SNR_required
 */
export function sensitivityDbm(cfg: Pick<RadioConfig, "sf" | "bw">): number {
  const bwHz = cfg.bw * 1000
  return (
    THERMAL_FLOOR_DBM_HZ +
    10 * Math.log10(bwHz) +
    NOISE_FIGURE_DB +
    SNR_REQUIRED[cfg.sf]
  )
}
