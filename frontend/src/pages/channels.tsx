import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { notifyError } from "@/lib/notify"
import {
  useAddChannel,
  useChannels,
  useRemoveChannel,
  type Channel,
} from "@/features/channels/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { ChannelAvatar } from "@/components/channel-avatar"
import { MuteToggle } from "@/features/mutes/MuteToggle"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function ChannelCard({ channel }: { channel: Channel }) {
  const navigate = useNavigate()
  const remove = useRemoveChannel()
  const name = channel.channel_name ?? `Channel ${channel.channel_idx}`

  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (
      !window.confirm(
        `Remove channel "${name}" (idx ${channel.channel_idx}) from local DB? ` +
          `Note: v1.1 does not push deletes to the device.`,
      )
    ) {
      return
    }
    remove.mutate(channel.channel_idx, {
      onSuccess: () => toast.success(`Removed channel ${name}`),
      onError: (err) => notifyError("Remove channel", err),
    })
  }

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/40"
      onClick={() => navigate(`/channel/${channel.channel_idx}`)}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelAvatar idx={channel.channel_idx} name={name} size="sm" />
          <CardTitle className="text-sm font-medium">
            <span className="text-muted-foreground">#{channel.channel_idx}</span>{" "}
            {name}
          </CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <MuteToggle
            kind="channel"
            targetKey={String(channel.channel_idx)}
            name={name}
            size="icon"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onRemove}
            disabled={remove.isPending}
            aria-label="Remove channel"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
    </Card>
  )
}

function AddChannelDialog() {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState("")
  const [name, setName] = useState("")
  const [psk, setPsk] = useState("")
  const add = useAddChannel()

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    const idxNum = parseInt(idx, 10)
    if (Number.isNaN(idxNum) || idxNum < 0) {
      toast.error("idx must be a non-negative integer")
      return
    }
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    add.mutate(
      { idx: idxNum, name: name.trim(), psk: psk.trim() || null },
      {
        onSuccess: () => {
          toast.success(`Added channel ${name}`)
          setOpen(false)
          setIdx("")
          setName("")
          setPsk("")
        },
        onError: (err) => notifyError("Add channel", err),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add channel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add channel</DialogTitle>
          <DialogDescription>
            Define a new MeshCore channel by index and name. PSK is optional.
            Note: v1.1 only writes to the local DB and does not push to the
            device.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="channel-idx">Index</Label>
            <Input
              id="channel-idx"
              type="number"
              min={0}
              value={idx}
              onChange={(e) => setIdx(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="channel-psk">PSK (optional)</Label>
            <Input
              id="channel-psk"
              value={psk}
              onChange={(e) => setPsk(e.target.value)}
              maxLength={128}
              placeholder="leave blank for none"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ChannelsPage() {
  const { data, isLoading, isError, error } = useChannels()

  return (
    <PageShell
      header={<PageHeader title="Channels" actions={<AddChannelDialog />} />}
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : isError ? (
        <div className="text-sm text-destructive">
          Failed to load channels:{" "}
          {error instanceof Error ? error.message : "unknown"}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No channels yet.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((ch) => (
            <ChannelCard key={ch.channel_idx} channel={ch} />
          ))}
        </div>
      )}
    </PageShell>
  )
}
