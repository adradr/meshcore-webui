import { useInfiniteQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { z } from "zod"

const MessageSchema = z.object({
  id: z.number(),
  msg_type: z.enum(["dm", "chan"]),
  contact_pub_key: z.string().nullable(),
  channel_idx: z.number().nullable(),
  direction: z.enum(["in", "out"]),
  text: z.string(),
  timestamp: z.string(),
  ack_state: z.string(),
})

const MessagesPage = z.object({
  items: z.array(MessageSchema),
  next_cursor: z.string().nullable(),
})

export type Message = z.infer<typeof MessageSchema>
export type MessagesPage = z.infer<typeof MessagesPage>

export function useMessages(contactPubKey?: string, channelIdx?: number) {
  return useInfiniteQuery({
    queryKey: ["messages", contactPubKey ?? `chan:${channelIdx}`] as const,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams()
      if (contactPubKey) q.set("contact_pub_key", contactPubKey)
      if (channelIdx != null) q.set("channel_idx", String(channelIdx))
      if (pageParam) q.set("before", pageParam as string)
      q.set("limit", "50")
      return api.get(`/api/messages?${q}`, MessagesPage)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}
