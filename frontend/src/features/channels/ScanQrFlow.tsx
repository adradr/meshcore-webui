import { useState } from "react"
import {
  Scanner,
  type IDetectedBarcode,
  type IScannerError,
} from "@yudiel/react-qr-scanner"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { JoinPrivateForm } from "./JoinPrivateForm"
import { parseChannelQrPayload, type QrChannelPayload } from "./validators"

/**
 * Two-stage QR-scan flow:
 *
 * 1. Show the camera scanner + a paste-URL fallback (desktop friendly).
 * 2. When a `meshcore://channel/add?name=…&secret=…` URI is decoded, hand
 *    the parsed fields to `JoinPrivateForm` so the user can confirm and
 *    write the channel.
 *
 * The scanner is lazy in practice: it only mounts when this component is
 * active inside the Add-Channel sheet, so we don't grab the camera until
 * the user explicitly picks the QR option.
 */
export function ScanQrFlow({ onSuccess }: { onSuccess: () => void }) {
  const [payload, setPayload] = useState<QrChannelPayload | null>(null)
  const [pasted, setPasted] = useState("")

  const handleRaw = (raw: string) => {
    const parsed = parseChannelQrPayload(raw)
    if (!parsed) {
      toast.error("Not a MeshCore channel QR / link")
      return
    }
    setPayload(parsed)
  }

  if (payload) {
    return (
      <div className="space-y-2">
        <div className="px-4 pt-2 text-xs text-muted-foreground">
          Decoded channel — review and confirm to write it to the radio.
        </div>
        <JoinPrivateForm prefill={payload} onSuccess={onSuccess} />
        <div className="px-4 pb-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPayload(null)}
          >
            Scan another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      <div className="overflow-hidden rounded-md border">
        <Scanner
          onScan={(codes: IDetectedBarcode[]) => {
            if (codes.length === 0) return
            handleRaw(codes[0].rawValue)
          }}
          onError={(err: IScannerError) => {
            // Camera access denied / no device — don't toast on every retry,
            // just log; the paste fallback is still usable.
            console.debug("[ScanQrFlow] scanner error", err)
          }}
          components={{ finder: false }}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="qr-paste">No camera? Paste the link instead</Label>
        <Input
          id="qr-paste"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="meshcore://channel/add?name=…&secret=…"
        />
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pasted.trim().length === 0}
            onClick={() => handleRaw(pasted.trim())}
          >
            Use link
          </Button>
        </div>
      </div>
    </div>
  )
}
