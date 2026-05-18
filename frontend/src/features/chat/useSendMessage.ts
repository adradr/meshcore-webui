import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"

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
      const previous = qc.getQueryData<OptimisticMessage[]>(key) ?? []
      const tempId = crypto.randomUUID()
      const optimistic: OptimisticMessage = {
        id: tempId,
        tempId,
        direction: "out",
        text: vars.text,
        timestamp: new Date().toISOString(),
        ack_state: "sending",
      }
      qc.setQueryData<OptimisticMessage[]>(key, [...previous, optimistic])
      return { key, previous, tempId }
    },
    onError: (err, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.previous)
      toast.error(err instanceof Error ? err.message : "Send failed")
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx) qc.invalidateQueries({ queryKey: ctx.key })
    },
  })
}
