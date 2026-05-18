import { z } from "zod"

const ContactMessageSchema = z.object({
  text: z.string(),
  pubkey_prefix: z.string().optional(),
  txt_type: z.number().optional(),
  sender_timestamp: z.number().optional(),
})

const ChannelMessageSchema = z.object({
  text: z.string(),
  channel_idx: z.number(),
  sender_timestamp: z.number().optional(),
})

export const WSMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("contact_message"),
    payload: ContactMessageSchema,
    attributes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("channel_message"),
    payload: ChannelMessageSchema,
    attributes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("ack"),
    payload: z.object({ code: z.string() }),
    attributes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("connected"),
    payload: z.record(z.string(), z.unknown()),
    attributes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("disconnected"),
    payload: z.record(z.string(), z.unknown()),
    attributes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("advertisement"),
    payload: z.object({ public_key: z.string() }),
    attributes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("pong"),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
])

export type WSMessage = z.infer<typeof WSMessageSchema>

export function parseWSMessage(raw: unknown): WSMessage | null {
  const r = WSMessageSchema.safeParse(raw)
  if (!r.success) {
    console.warn("[ws] invalid", r.error.issues)
    return null
  }
  return r.data
}
