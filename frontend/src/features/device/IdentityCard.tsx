/**
 * IdentityCard — view/edit device name + read-only public key display.
 *
 * Usage:
 *   <IdentityCard selfInfo={data} />
 */
import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import type { SelfInfo } from "./queries"
import { useSetDeviceName } from "./behaviourQueries"

interface Props {
  selfInfo: SelfInfo | undefined
  isLoading: boolean
}

function truncatePubKey(pk: string): string {
  if (pk.length <= 16) return pk
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`
}

export function IdentityCard({ selfInfo, isLoading }: Props) {
  const [editing, setEditing] = useState(false)
  const [nameText, setNameText] = useState("")
  const setDeviceName = useSetDeviceName()

  const startEdit = () => {
    setNameText(selfInfo?.name ?? "")
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setNameText("")
  }

  const onSave = () => {
    const trimmed = nameText.trim()
    if (!trimmed) return
    setDeviceName.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setEditing(false)
          setNameText("")
        },
      },
    )
  }

  const saving = setDeviceName.isPending
  const canSave =
    nameText.trim().length >= 1 && nameText.trim().length <= 32

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Identity</CardTitle>
          {!editing && !isLoading && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={startEdit}
              aria-label="Edit device name"
            >
              Edit
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">
          The advertised name and Ed25519 public key that identify this node on
          the mesh. The public key is the permanent mesh identity — peers
          remember it across reboots, so changing the name does not change who
          you are. A factory reset wipes the keypair and you appear as a brand
          new node.{" "}
          <a
            href="https://github.com/meshcore-dev/MeshCore/blob/main/docs/packet_format.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            MeshCore packet format
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {/* NAME row */}
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Name
              </Label>
              {editing ? (
                <Input
                  data-testid="identity-name-input"
                  value={nameText}
                  onChange={(e) => setNameText(e.target.value)}
                  maxLength={32}
                  minLength={1}
                  disabled={saving}
                  placeholder="Device name"
                  aria-label="Device name"
                />
              ) : (
                <p
                  data-testid="identity-name-display"
                  className="text-sm font-medium"
                >
                  {selfInfo?.name ?? "—"}
                </p>
              )}
            </div>

            {/* PUBLIC KEY row — always read-only */}
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Public key
              </Label>
              <p className="font-mono text-xs text-muted-foreground">
                {selfInfo?.public_key
                  ? truncatePubKey(selfInfo.public_key)
                  : "—"}
              </p>
            </div>

            {/* Save / Cancel footer */}
            {editing && (
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-testid="identity-save-btn"
                  onClick={onSave}
                  disabled={saving || !canSave}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
