export interface RadioConfig {
  freq: number
  bw: number
  sf: 7 | 8 | 9 | 10 | 11 | 12
  cr: 5 | 6 | 7 | 8
}

export interface RadioReadout extends RadioConfig {
  tx_power: number
  max_tx_power: number
}

export interface TuningParams {
  rx_delay: number
  airtime_factor: number
}
