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
    type: z.literal("acknowledgement"),
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
    // The strict union only covers events the WebSocketProvider's
    // switch handles. Everything else (rx_log_data, stats_radio,
    // diagnostic.step, trace_data, …) is delivered via topic fan-out
    // through `parseWireEvent`, so a discriminator miss here is
    // expected — not a bug. We demote to debug so devtools is quiet.
    const looksLikeUnknownType = r.error.issues.some(
      (i) =>
        i.code === "invalid_union" &&
        // zod 4 surfaces the discriminator name on the issue
        (i as { discriminator?: string }).discriminator === "type",
    )
    if (looksLikeUnknownType) {
      console.debug("[ws] non-dispatch event (handled via topic)", raw)
    } else {
      console.warn("[ws] invalid", r.error.issues)
    }
    return null
  }
  return r.data
}

/**
 * Loose wire envelope schema mirroring the backend `WireEvent` dataclass.
 *
 * Used for topic-based routing where we only need the envelope (type/topic)
 * and do not want to enforce the per-type payload shape (that is the job of
 * `WSMessageSchema` and downstream consumers).
 *
 * The `topic` field defaults to `"system"` to match backend behaviour for
 * unknown event types (see `topic_for_event_type` in
 * `backend/app/services/meshcore_client.py`).
 */
export const WireEventSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  topic: z.string().optional().default("system"),
})

export type WireEvent = z.infer<typeof WireEventSchema>

export function parseWireEvent(raw: unknown): WireEvent {
  return WireEventSchema.parse(raw)
}
