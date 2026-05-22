import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { notifyError } from "@/lib/notify"
import {
  useChannels,
  useRemoveChannel,
  type Channel,
} from "@/features/channels/queries"
import { AddChannelSheet } from "@/features/channels/AddChannelSheet"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import { ChannelAvatar } from "@/components/channel-avatar"
import { MuteToggle } from "@/features/mutes/MuteToggle"
import { Skeleton } from "@/components/ui/skeleton"

function ChannelCard({ channel }: { channel: Channel }) {
  const navigate = useNavigate()
  const remove = useRemoveChannel()
  const name = channel.channel_name ?? `Channel ${channel.channel_idx}`

  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (
      !window.confirm(
        `Remove channel "${name}" (idx ${channel.channel_idx}) from the ` +
          `device? This clears the slot in radio flash and cannot be undone.`,
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

export function ChannelsPage() {
  const { data, isLoading, isError, error } = useChannels()

  return (
    <PageShell
      header={<PageHeader title="Channels" actions={<AddChannelSheet />} />}
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
