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
      <p className="text-xs text-muted-foreground">
        Behavioural settings control how this node identifies itself, what it
        reports to peers, and how it pairs with mobile clients. Changes here
        write to the device's persistent config and take effect on the next
        radio interaction — they do not require a reboot. For background on the
        protocol, see the{" "}
        <a
          href="https://github.com/meshcore-dev/MeshCore/blob/main/docs/faq.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          MeshCore FAQ
        </a>
        .
      </p>
      <IdentityCard selfInfo={selfInfo} isLoading={isLoading} />
      <TelemetryCard selfInfo={selfInfo} isLoading={isLoading} />
      <AdvertPolicyCard selfInfo={selfInfo} isLoading={isLoading} />
      <BlePinCard />
      <CustomVarsCard />
      <TimeSyncCard />
    </div>
  )
}
