import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Plus, Trash2, Eye, EyeOff } from "lucide-react"
import {
  useAddChannel,
  useChannels,
  useRemoveChannel,
  type Channel,
} from "@/features/channels/queries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [showPsk, setShowPsk] = useState(false)
  const navigate = useNavigate()
  const remove = useRemoveChannel()

  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Remove channel "${channel.name}" (idx ${channel.idx})?`)) {
      return
    }
    remove.mutate(channel.idx, {
      onSuccess: () => toast.success(`Removed channel ${channel.name}`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Remove failed"),
    })
  }

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/40"
      onClick={() => navigate(`/channel/${channel.idx}`)}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium">
            <span className="text-muted-foreground">#{channel.idx}</span>{" "}
            {channel.name}
          </CardTitle>
        </div>
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
      </CardHeader>
      {channel.psk && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">PSK:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {showPsk ? channel.psk : "•".repeat(Math.min(channel.psk.length, 12))}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation()
                setShowPsk((s) => !s)
              }}
              aria-label={showPsk ? "Hide PSK" : "Show PSK"}
            >
              {showPsk ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          </div>
        </CardContent>
      )}
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
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Add failed"),
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold">Channels</h2>
        <AddChannelDialog />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
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
            No channels yet. Click "Add channel" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {data.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
