import { z } from "zod"

const ContactMessageSchema = z.object({
  text: z.string(),
  // Full 64-hex lowercase pubkey, enriched server-side when the contact
  // cache resolves the wire's short prefix. Optional — resolution is
  // best-effort and older backends don't send it.
  pubkey: z.string().optional(),
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
    // Emitted by the backend AckTimeoutSweeper when an outgoing DM's RF
    // ACK never arrived within the configured timeout.
    type: z.literal("ack_failed"),
    payload: z.object({
      message_id: z.number().optional(),
      code: z.string().nullable().optional(),
      contact_pub_key: z.string().nullable().optional(),
    }),
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

/* ------------------------------------------------------------------------ *
 * Per-topic payload schemas — defensive validation in `useWsTopic`.
 *
 * The radio chain emits payloads we ultimately re-broadcast to every WS
 * subscriber. The backend is trusted, but it forwards content sourced from
 * peers on the LoRa mesh (RX_LOG_DATA, TRACE_DATA, advertisements). A hostile
 * peer with a malformed packet shouldn't be able to make a subscriber's
 * destructure throw. Each schema below mirrors the backend Pydantic / TS
 * consumer shape, and `useWsTopic` drops anything that fails to parse with
 * a `console.warn`. Schemas are intentionally permissive on fields the
 * consumer doesn't care about — we want to filter "obviously not mine"
 * payloads, not enforce a full type-check.
 *
 * Topics NOT listed here pass through unvalidated (loose escape hatch).
 * ------------------------------------------------------------------------ */

// `noise` topic — mirrors `NoisePoller._payload_from_event_payload` in
// `backend/app/services/noise_poller.py`. `t_ms` is the only field the
// chart consumer needs to plot; everything else is nullable/optional.
export const NoisePayloadSchema = z.object({
  noise_floor: z.number().nullable().optional(),
  last_rssi: z.number().nullable().optional(),
  last_snr: z.number().nullable().optional(),
  tx_air_secs: z.number().nullable().optional(),
  rx_air_secs: z.number().nullable().optional(),
  t_ms: z.number(),
})

// `rx_log` topic — mirrors the sanitized RX_LOG_DATA payload from
// `_sanitize_rx_log_payload` in meshcore_client.py. Real packets carry
// many extra firmware-specific fields (`header`, `payload_ver`, `adv_*`…)
// that the UI just renders verbatim, so we use passthrough() to let them
// flow through without invalidating the message.
export const RxLogPayloadSchema = z
  .object({
    recv_time: z.number().nullable().optional(),
    snr: z.number().nullable().optional(),
    rssi: z.number().nullable().optional(),
    payload: z.string().nullable().optional(),
    payload_length: z.number().nullable().optional(),
    route_type: z.number().nullable().optional(),
    route_typename: z.string().nullable().optional(),
    payload_type: z.number().nullable().optional(),
    payload_typename: z.string().nullable().optional(),
    path_len: z.number().nullable().optional(),
    path_hash_size: z.number().nullable().optional(),
    path: z.string().nullable().optional(),
    pkt_hash: z.string().nullable().optional(),
    raw_hex: z.string().nullable().optional(),
  })
  .loose()

// `trace_monitor` topic — mirrors `TraceSampleOut` in
// `backend/app/schemas/trace_monitor.py`. The consumer
// (`useTraceMonitorSamples`) filters by `session_id` so that field MUST be
// present and a string; everything else can be permissive.
const TraceHopPayloadSchema = z.object({
  hash: z.string(),
  snr: z.number(),
})
export const TraceMonitorPayloadSchema = z.object({
  session_id: z.string(),
  target_pubkey: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  status: z.enum(["ok", "timeout", "unreachable", "error"]),
  path_len: z.number().nullable().optional(),
  snr_there: z.number().nullable().optional(),
  snr_back: z.number().nullable().optional(),
  hops: z.array(TraceHopPayloadSchema).optional().default([]),
  error: z.string().nullable().optional(),
})

// Lookup keyed by topic name. Topics not listed here are intentionally
// unvalidated — see useWsTopic.ts.
export const TOPIC_PAYLOAD_SCHEMAS = {
  noise: NoisePayloadSchema,
  rx_log: RxLogPayloadSchema,
  trace_monitor: TraceMonitorPayloadSchema,
} as const

export type ValidatedTopic = keyof typeof TOPIC_PAYLOAD_SCHEMAS
export type PayloadFor<K extends ValidatedTopic> = z.infer<
  (typeof TOPIC_PAYLOAD_SCHEMAS)[K]
>
