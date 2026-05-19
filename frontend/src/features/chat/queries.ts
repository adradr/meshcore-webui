import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  pubkey_prefix: z.string().nullable().optional(),
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

const ThreadSchema = z.object({
  msg_type: z.enum(["dm", "chan"]),
  contact_pub_key: z.string().nullable(),
  channel_idx: z.number().nullable(),
  last_text: z.string(),
  last_timestamp: z.string().nullable(),
  last_direction: z.enum(["in", "out"]),
  unread_count: z.number().default(0),
})
export type Thread = z.infer<typeof ThreadSchema>

export function useThreads() {
  return useQuery({
    queryKey: ["threads"],
    queryFn: () => api.get("/api/messages/threads", z.array(ThreadSchema)),
    staleTime: 10_000,
  })
}

const UnreadTotalSchema = z.object({ total: z.number() })

export function useUnreadTotal() {
  return useQuery({
    queryKey: ["threads", "total"],
    queryFn: () =>
      api.get("/api/conversations/unread-total", UnreadTotalSchema),
    staleTime: 10_000,
  })
}

export interface MarkReadVars {
  contactPubKey?: string
  channelIdx?: number
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: MarkReadVars) =>
      api.post("/api/conversations/read", {
        contact_pub_key: vars.contactPubKey,
        channel_idx: vars.channelIdx,
      }),
    onSuccess: () => {
      // Invalidating ["threads"] also matches ["threads", "total"] in
      // TanStack Query v5 (prefix match by default).
      qc.invalidateQueries({ queryKey: ["threads"] })
    },
  })
}

export function useDeleteMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/messages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] })
      qc.invalidateQueries({ queryKey: ["threads"] })
    },
  })
}
