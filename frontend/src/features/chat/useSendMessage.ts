import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { InfiniteData } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

interface SendArgs {
  contactPubKey?: string
  channelIdx?: number
  text: string
}

interface OptimisticMessage {
  id: string
  tempId: string
  direction: "out"
  text: string
  timestamp: string
  ack_state: string
}

// Shape returned by useInfiniteQuery in queries.ts
interface MessagesPage {
  items: unknown[]
  next_cursor: string | null
}
type MessagesData = InfiniteData<MessagesPage>

/**
 * Mirrors the backend's `_with_sender_prefix` (meshcore_client.py):
 * channel message bodies are stored as "<self name>: <text>", so the
 * optimistic bubble must carry the same prefix or it visibly rewrites
 * itself when the canonical refetch lands.
 */
function withSenderPrefix(text: string, selfName: string | undefined): string {
  if (!selfName) return text
  const prefix = `${selfName}: `
  return text.startsWith(prefix) ? text : prefix + text
}

export function useSendMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ contactPubKey, channelIdx, text }: SendArgs) =>
      api.post("/api/messages", {
        contact_pub_key: contactPubKey,
        channel_idx: channelIdx,
        text,
      }),
    onMutate: async (vars) => {
      const key = [
        "messages",
        vars.contactPubKey ?? `chan:${vars.channelIdx}`,
      ] as const
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<MessagesData>(key)
      const tempId = crypto.randomUUID()
      const isChannel = vars.channelIdx !== undefined
      const selfName = isChannel
        ? qc.getQueryData<{ name?: string }>(["device", "self-info"])?.name
        : undefined
      const optimistic: OptimisticMessage = {
        id: tempId,
        tempId,
        direction: "out",
        text: isChannel ? withSenderPrefix(vars.text, selfName) : vars.text,
        timestamp: new Date().toISOString(),
        ack_state: "sending",
      }
      // Backend returns DESC by timestamp — newest first within each page —
      // so prepend to the first page so the message renders at the bottom
      // (MessageList .reverse()s the pages-flattened list).
      qc.setQueryData<MessagesData>(key, (old) => {
        if (!old || !old.pages || old.pages.length === 0) {
          return {
            pages: [{ items: [optimistic], next_cursor: null }],
            pageParams: [undefined],
          }
        }
        const [first, ...rest] = old.pages
        return {
          pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest],
          pageParams: old.pageParams,
        }
      })
      return { key, previous, tempId }
    },
    onError: (err, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.previous)
      notifyError("Send", err)
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx) qc.invalidateQueries({ queryKey: ctx.key })
      // The Conversations list shows last_text/timestamp — refresh it too,
      // otherwise the thread row stays stale until an unrelated event.
      qc.invalidateQueries({ queryKey: ["threads"] })
    },
  })
}
