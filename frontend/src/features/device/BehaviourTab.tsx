/**
 * BehaviourTab — Tasks 5.1–5.6
 *
 * Stacks 6 configuration cards:
 *  1. IdentityCard       — device name (editable) + public key (read-only)
 *  2. TelemetryCard      — three telemetry sub-mode selects
 *  3. AdvertPolicyCard   — adv_loc_policy / manual_add_contacts / multi_acks
 *  4. BlePinCard         — write-only BLE pairing PIN
 *  5. CustomVarsCard     — firmware-defined key/value variables
 *  6. TimeSyncCard       — device/server time + skew + sync button
 *
 * Usage:
 *   <BehaviourTab />
 */
import { useSelfInfo } from "./queries"
import { IdentityCard } from "./IdentityCard"
import { TelemetryCard } from "./TelemetryCard"
import { AdvertPolicyCard } from "./AdvertPolicyCard"
import { BlePinCard } from "./BlePinCard"
import { CustomVarsCard } from "./CustomVarsCard"
import { TimeSyncCard } from "./TimeSyncCard"

export function BehaviourTab() {
  const { data: selfInfo, isLoading } = useSelfInfo()

  return (
    <div className="flex flex-col gap-4">
      <IdentityCard selfInfo={selfInfo} isLoading={isLoading} />
      <TelemetryCard selfInfo={selfInfo} isLoading={isLoading} />
      <AdvertPolicyCard selfInfo={selfInfo} isLoading={isLoading} />
      <BlePinCard />
      <CustomVarsCard />
      <TimeSyncCard />
    </div>
  )
}
